import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import {
  STRATEGY_PROMPT,
  CONCEPT_PROMPT,
  SCRIPT_PROMPT,
  STORYBOARD_PROMPT,
  FEEDBACK_ANALYSIS_PROMPT,
  BRAND_CONTEXT,
} from '../prompts/system.js';
import * as store from '../memory/store.js';

const router = Router();

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Build context string from memory so Claude has full recall
function buildMemoryContext(projectId) {
  const ctx = store.getFullContext(projectId);
  if (!ctx.project) return '';

  let memory = '\n\n--- MEMORY: FULL PROJECT CONTEXT ---\n';

  if (ctx.patterns.approved.length > 0) {
    memory += '\nAPPROVED (what works):\n';
    ctx.patterns.approved.forEach(p => {
      memory += `- "${p.title}" (${p.stage})${p.comment ? `: "${p.comment}"` : ''}\n`;
    });
  }

  if (ctx.patterns.rejected.length > 0) {
    memory += '\nREJECTED (what doesn\'t work):\n';
    ctx.patterns.rejected.forEach(p => {
      memory += `- "${p.title}" (${p.stage})${p.comment ? `: "${p.comment}"` : ''}\n`;
    });
  }

  if (ctx.patterns.rules.length > 0) {
    memory += '\nLEARNED RULES (from revision feedback):\n';
    ctx.patterns.rules.forEach(r => {
      memory += `- From "${r.from}": ${r.rule}\n`;
    });
  }

  if (ctx.contradictions.length > 0) {
    memory += '\nACTIVE CONTRADICTIONS (be careful):\n';
    ctx.contradictions.forEach(c => {
      memory += `- ${c.description}\n`;
    });
  }

  // Include existing items so Claude doesn't repeat
  if (ctx.strategies.length > 0) {
    memory += '\nEXISTING STRATEGIES (do NOT repeat these):\n';
    ctx.strategies.forEach(s => {
      memory += `- "${s.title}": ${s.description}\n`;
    });
  }

  if (ctx.concepts.length > 0) {
    memory += '\nEXISTING CONCEPTS (do NOT repeat these):\n';
    ctx.concepts.forEach(c => {
      memory += `- "${c.title}": ${c.description} [${c.status}]\n`;
    });
  }

  memory += '\n--- END MEMORY ---\n';
  return memory;
}

// Generic generation function
async function generate(systemPrompt, userMessage, projectId) {
  const client = getClient();
  const memoryCtx = buildMemoryContext(projectId);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: systemPrompt + memoryCtx,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0]?.text || '';

  // Extract JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  const objMatch = text.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (e) { /* fall through */ }
  }
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (e) { /* fall through */ }
  }

  return { raw: text };
}

// ─── GENERATE STRATEGIES ───
router.post('/strategies', async (req, res) => {
  try {
    const { projectId, count = 5, direction } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const userMsg = direction
      ? `Generate ${count} strategy pillars. Creative direction hint: ${direction}`
      : `Generate ${count} fresh strategy pillars for the current brand.`;

    const result = await generate(STRATEGY_PROMPT, userMsg, projectId);

    if (Array.isArray(result)) {
      const items = result.map(s => ({
        id: uuid(),
        title: s.title,
        description: s.description,
        details: s.details || [],
        exampleConcepts: s.exampleConcepts || [],
        status: 'pending',
        comments: [],
        createdAt: Date.now(),
      }));
      const updated = store.addItems(projectId, 'strategies', items);
      return res.json({ items: updated, generated: items.length });
    }

    res.json({ items: [], raw: result });
  } catch (err) {
    console.error('Strategy generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GENERATE CONCEPTS ───
router.post('/concepts', async (req, res) => {
  try {
    const { projectId, count = 5, strategyId, direction } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    let userMsg = `Generate ${count} creative concepts.`;

    if (strategyId) {
      const strategies = store.getItems(projectId, 'strategies');
      const strategy = strategies.find(s => s.id === strategyId);
      if (strategy) {
        userMsg += ` These should align with the strategy: "${strategy.title}" — ${strategy.description}`;
      }
    }

    if (direction) {
      userMsg += ` Additional direction: ${direction}`;
    }

    const result = await generate(CONCEPT_PROMPT, userMsg, projectId);

    if (Array.isArray(result)) {
      const items = result.map(c => ({
        id: uuid(),
        title: c.title,
        description: c.description,
        tier: c.tier || 'A',
        format: c.format || 'Semi-Realism',
        duration: c.duration || '20s',
        heroCopy: c.heroCopy || 'The smarter screen time.',
        hooks: c.hooks || [],
        caption: c.caption || '',
        status: 'pending',
        comments: [],
        parentId: strategyId || null,
        createdAt: Date.now(),
      }));
      const updated = store.addItems(projectId, 'concepts', items);
      return res.json({ items: updated, generated: items.length });
    }

    res.json({ items: [], raw: result });
  } catch (err) {
    console.error('Concept generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GENERATE SCRIPTS ───
router.post('/scripts', async (req, res) => {
  try {
    const { projectId, conceptId } = req.body;
    if (!projectId || !conceptId) return res.status(400).json({ error: 'projectId and conceptId required' });

    const concepts = store.getItems(projectId, 'concepts');
    const concept = concepts.find(c => c.id === conceptId);
    if (!concept) return res.status(404).json({ error: 'Concept not found' });

    const userMsg = `Write a detailed shot-by-shot script for this concept:

Title: "${concept.title}"
Description: ${concept.description}
Format: ${concept.format}
Duration: ${concept.duration}
Hero Copy: "${concept.heroCopy}"
Existing hooks: ${concept.hooks?.join(' | ') || 'None'}`;

    const result = await generate(SCRIPT_PROMPT, userMsg, projectId);

    const scriptItem = {
      id: uuid(),
      title: `Script: ${concept.title}`,
      description: concept.description,
      status: 'pending',
      comments: [],
      parentId: concept.id,
      tier: concept.tier,
      format: concept.format,
      duration: concept.duration,
      heroCopy: concept.heroCopy,
      script: result.script || result,
      hooks: result.hooks || concept.hooks,
      caption: result.caption || concept.caption,
      productionNotes: result.production_notes || '',
      createdAt: Date.now(),
    };

    const updated = store.addItems(projectId, 'scripts', [scriptItem]);
    res.json({ item: scriptItem, items: updated });
  } catch (err) {
    console.error('Script generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GENERATE SCRIPTS FOR ALL APPROVED CONCEPTS ───
router.post('/scripts/batch', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const concepts = store.getItems(projectId, 'concepts');
    const approved = concepts.filter(c => c.status === 'approved');
    const existingScripts = store.getItems(projectId, 'scripts');
    const existingParentIds = new Set(existingScripts.map(s => s.parentId));

    const toGenerate = approved.filter(c => !existingParentIds.has(c.id));

    if (toGenerate.length === 0) {
      return res.json({ items: existingScripts, generated: 0, message: 'All approved concepts already have scripts.' });
    }

    const generated = [];
    for (const concept of toGenerate) {
      const userMsg = `Write a detailed shot-by-shot script for this concept:
Title: "${concept.title}"
Description: ${concept.description}
Format: ${concept.format}
Duration: ${concept.duration}
Hero Copy: "${concept.heroCopy}"`;

      const result = await generate(SCRIPT_PROMPT, userMsg, projectId);

      generated.push({
        id: uuid(),
        title: `Script: ${concept.title}`,
        description: concept.description,
        status: 'pending',
        comments: [],
        parentId: concept.id,
        tier: concept.tier,
        format: concept.format,
        duration: concept.duration,
        heroCopy: concept.heroCopy,
        script: result.script || result,
        hooks: result.hooks || concept.hooks,
        caption: result.caption || concept.caption,
        productionNotes: result.production_notes || '',
        createdAt: Date.now(),
      });
    }

    const updated = store.addItems(projectId, 'scripts', generated);
    res.json({ items: updated, generated: generated.length });
  } catch (err) {
    console.error('Batch script generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ANALYZE FEEDBACK ───
router.post('/analyze-feedback', async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const ctx = store.getFullContext(projectId);
    const userMsg = `Analyze all feedback for this project and give me actionable insights.

Total decisions: ${ctx.summary.totalFeedback}
Approved: ${ctx.summary.approvedCount}
Rejected: ${ctx.summary.rejectedCount}
Revisions: ${ctx.summary.revisionCount}
Active contradictions: ${ctx.summary.activeContradictions}

Full feedback history:
${JSON.stringify(ctx.feedback, null, 2)}`;

    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: FEEDBACK_ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    });

    const analysis = response.content[0]?.text || '';
    res.json({ analysis });
  } catch (err) {
    console.error('Feedback analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ITERATE (regenerate with feedback context) ───
router.post('/iterate', async (req, res) => {
  try {
    const { projectId, stage, itemId, direction } = req.body;
    if (!projectId || !stage || !itemId) {
      return res.status(400).json({ error: 'projectId, stage, and itemId required' });
    }

    const items = store.getItems(projectId, stage);
    const item = items.find(i => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const feedbackOnItem = store.getFeedback(projectId)
      .filter(f => f.itemId === itemId)
      .map(f => `[${f.action}] ${f.comment || 'No comment'}`)
      .join('\n');

    const promptMap = {
      strategies: STRATEGY_PROMPT,
      concepts: CONCEPT_PROMPT,
      scripts: SCRIPT_PROMPT,
    };

    const userMsg = `ITERATE on this existing item based on feedback:

Current item: "${item.title}"
Description: ${item.description}
Status: ${item.status}

Feedback received:
${feedbackOnItem || 'No specific feedback yet.'}

${direction ? `Additional direction: ${direction}` : ''}

Generate an IMPROVED version that addresses the feedback. Return the same JSON format.`;

    const result = await generate(promptMap[stage] || CONCEPT_PROMPT, userMsg, projectId);

    // Update the existing item with new content
    const updated = Array.isArray(result) ? result[0] : result;
    const merged = {
      ...item,
      description: updated.description || item.description,
      details: updated.details || item.details,
      hooks: updated.hooks || item.hooks,
      caption: updated.caption || item.caption,
      script: updated.script || item.script,
      status: 'pending', // Reset to pending after iteration
      updatedAt: Date.now(),
      comments: [...item.comments, {
        id: uuid(),
        text: `[AI] Iterated based on feedback. ${direction || ''}`,
        timestamp: Date.now(),
        author: 'system',
      }],
    };

    store.updateItem(projectId, stage, itemId, merged);
    res.json({ item: merged });
  } catch (err) {
    console.error('Iteration error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
