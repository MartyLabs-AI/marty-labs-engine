import { Router } from 'express';
import Replicate from 'replicate';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import * as store from '../memory/store.js';
import { STORYBOARD_PROMPT } from '../prompts/system.js';

const router = Router();

function getReplicate() {
  return new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
}

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Generate storyboard prompts using Claude, then images using Flux
router.post('/storyboard', async (req, res) => {
  try {
    const { projectId, scriptId } = req.body;
    if (!projectId || !scriptId) return res.status(400).json({ error: 'projectId and scriptId required' });

    const scripts = store.getItems(projectId, 'scripts');
    const script = scripts.find(s => s.id === scriptId);
    if (!script) return res.status(404).json({ error: 'Script not found' });

    // Step 1: Use Claude to generate image prompts for each frame
    const anthropic = getAnthropic();
    const scriptDesc = Array.isArray(script.script)
      ? script.script.map(s => `[${s.time}] ${s.label}: ${s.desc}`).join('\n')
      : JSON.stringify(script.script);

    const promptResponse = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: STORYBOARD_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate storyboard frame image prompts for this script:

Title: "${script.title}"
Format: ${script.format}
Duration: ${script.duration}

Shot list:
${scriptDesc}

Create one image prompt per shot. Keep character descriptions consistent across all frames.`,
      }],
    });

    const promptText = promptResponse.content[0]?.text || '';
    let frames;
    try {
      const jsonMatch = promptText.match(/\[[\s\S]*\]/);
      frames = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      frames = [];
    }

    if (frames.length === 0) {
      return res.status(500).json({ error: 'Failed to generate frame prompts' });
    }

    // Step 2: Generate images with Flux 2 Klein via Replicate
    const replicate = getReplicate();
    const generatedFrames = [];

    for (const frame of frames) {
      try {
        const output = await replicate.run(
          'black-forest-labs/flux-2-klein-9b',
          {
            input: {
              prompt: frame.image_prompt,
              num_outputs: 1,
              aspect_ratio: '16:9',
              output_format: 'webp',
              output_quality: 80,
            },
          }
        );

        generatedFrames.push({
          id: uuid(),
          scene: frame.scene,
          description: frame.description,
          imagePrompt: frame.image_prompt,
          imageUrl: Array.isArray(output) ? output[0] : output,
          notes: frame.notes,
          status: 'pending',
        });
      } catch (imgErr) {
        console.error(`Image gen failed for frame ${frame.scene}:`, imgErr.message);
        generatedFrames.push({
          id: uuid(),
          scene: frame.scene,
          description: frame.description,
          imagePrompt: frame.image_prompt,
          imageUrl: null,
          error: imgErr.message,
          notes: frame.notes,
          status: 'pending',
        });
      }
    }

    // Step 3: Save storyboard
    const storyboard = {
      id: uuid(),
      title: `Board: ${script.title.replace('Script: ', '')}`,
      description: script.description,
      status: 'pending',
      comments: [],
      parentId: script.id,
      tier: script.tier,
      format: script.format,
      duration: script.duration,
      frames: generatedFrames,
      createdAt: Date.now(),
    };

    const updated = store.addItems(projectId, 'storyboards', [storyboard]);
    res.json({ item: storyboard, items: updated });
  } catch (err) {
    console.error('Storyboard generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Regenerate a single frame
router.post('/storyboard/reframe', async (req, res) => {
  try {
    const { projectId, storyboardId, frameId, direction } = req.body;
    if (!projectId || !storyboardId || !frameId) {
      return res.status(400).json({ error: 'projectId, storyboardId, and frameId required' });
    }

    const storyboards = store.getItems(projectId, 'storyboards');
    const board = storyboards.find(s => s.id === storyboardId);
    if (!board) return res.status(404).json({ error: 'Storyboard not found' });

    const frame = board.frames?.find(f => f.id === frameId);
    if (!frame) return res.status(404).json({ error: 'Frame not found' });

    // Update the prompt if direction given
    let imagePrompt = frame.imagePrompt;
    if (direction) {
      const anthropic = getAnthropic();
      const refineResponse = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Refine this image generation prompt based on feedback:

Original prompt: "${frame.imagePrompt}"
Feedback: "${direction}"

Return ONLY the refined prompt text, nothing else.`,
        }],
      });
      imagePrompt = refineResponse.content[0]?.text?.trim() || imagePrompt;
    }

    // Regenerate image
    const replicate = getReplicate();
    const output = await replicate.run(
      'black-forest-labs/flux-2-klein-9b',
      {
        input: {
          prompt: imagePrompt,
          num_outputs: 1,
          aspect_ratio: '16:9',
          output_format: 'webp',
          output_quality: 80,
        },
      }
    );

    // Update frame in storyboard
    const updatedFrames = board.frames.map(f => {
      if (f.id !== frameId) return f;
      return {
        ...f,
        imagePrompt,
        imageUrl: Array.isArray(output) ? output[0] : output,
        error: null,
        regeneratedAt: Date.now(),
      };
    });

    store.updateItem(projectId, 'storyboards', storyboardId, { frames: updatedFrames });
    const updatedFrame = updatedFrames.find(f => f.id === frameId);
    res.json({ frame: updatedFrame });
  } catch (err) {
    console.error('Reframe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Batch generate storyboards for all approved scripts
router.post('/storyboard/batch', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const scripts = store.getItems(projectId, 'scripts');
    const approved = scripts.filter(s => s.status === 'approved');
    const existing = store.getItems(projectId, 'storyboards');
    const existingParentIds = new Set(existing.map(s => s.parentId));

    const toGenerate = approved.filter(s => !existingParentIds.has(s.id));

    if (toGenerate.length === 0) {
      return res.json({ items: existing, generated: 0, message: 'All approved scripts already have storyboards.' });
    }

    // Send initial response, generate in background
    res.json({
      status: 'generating',
      count: toGenerate.length,
      message: `Generating storyboards for ${toGenerate.length} scripts. This will take a few minutes. Poll GET /api/items/:projectId/storyboards for updates.`,
    });

    // Generate in background (don't await in response)
    (async () => {
      for (const script of toGenerate) {
        try {
          const anthropic = getAnthropic();
          const scriptDesc = Array.isArray(script.script)
            ? script.script.map(s => `[${s.time}] ${s.label}: ${s.desc}`).join('\n')
            : JSON.stringify(script.script);

          const promptResponse = await anthropic.messages.create({
            model: 'claude-opus-4-6',
            max_tokens: 4096,
            system: STORYBOARD_PROMPT,
            messages: [{
              role: 'user',
              content: `Generate storyboard frame prompts for: "${script.title}"\nShot list:\n${scriptDesc}`,
            }],
          });

          const promptText = promptResponse.content[0]?.text || '';
          let frames = [];
          try {
            const jsonMatch = promptText.match(/\[[\s\S]*\]/);
            frames = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
          } catch { /* empty */ }

          const replicate = getReplicate();
          const generatedFrames = [];

          for (const frame of frames) {
            try {
              const output = await replicate.run('black-forest-labs/flux-2-klein-9b', {
                input: { prompt: frame.image_prompt, num_outputs: 1, aspect_ratio: '16:9', output_format: 'webp', output_quality: 80 },
              });
              generatedFrames.push({
                id: uuid(), scene: frame.scene, description: frame.description,
                imagePrompt: frame.image_prompt, imageUrl: Array.isArray(output) ? output[0] : output,
                notes: frame.notes, status: 'pending',
              });
            } catch (imgErr) {
              generatedFrames.push({
                id: uuid(), scene: frame.scene, description: frame.description,
                imagePrompt: frame.image_prompt, imageUrl: null, error: imgErr.message,
                notes: frame.notes, status: 'pending',
              });
            }
          }

          store.addItems(projectId, 'storyboards', [{
            id: uuid(), title: `Board: ${script.title.replace('Script: ', '')}`,
            description: script.description, status: 'pending', comments: [], parentId: script.id,
            tier: script.tier, format: script.format, duration: script.duration,
            frames: generatedFrames, createdAt: Date.now(),
          }]);
        } catch (err) {
          console.error(`Storyboard gen failed for ${script.title}:`, err.message);
        }
      }
    })();
  } catch (err) {
    console.error('Batch storyboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
