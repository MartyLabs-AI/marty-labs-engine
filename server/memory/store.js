import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';

const DATA_DIR = process.env.MEMORY_PATH || './server/memory/data';

// Ensure data directory exists
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJSON(file) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

function writeJSON(file, data) {
  ensureDir();
  const fp = path.join(DATA_DIR, file);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── PROJECT MANAGEMENT ───
export function listProjects() {
  ensureDir();
  const indexFile = path.join(DATA_DIR, '_projects.json');
  if (!fs.existsSync(indexFile)) return [];
  return JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
}

export function createProject(name, brandData = {}) {
  const projects = listProjects();
  const project = {
    id: uuid(),
    name,
    brandData,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  projects.push(project);
  writeJSON('_projects.json', projects);

  // Initialize empty project data files
  writeJSON(`${project.id}_strategies.json`, []);
  writeJSON(`${project.id}_concepts.json`, []);
  writeJSON(`${project.id}_scripts.json`, []);
  writeJSON(`${project.id}_storyboards.json`, []);
  writeJSON(`${project.id}_feedback.json`, []);
  writeJSON(`${project.id}_patterns.json`, { approved: [], rejected: [], rules: [] });

  return project;
}

export function getProject(projectId) {
  const projects = listProjects();
  return projects.find(p => p.id === projectId) || null;
}

// ─── PIPELINE ITEMS (strategies, concepts, scripts, storyboards) ───
export function getItems(projectId, stage) {
  return readJSON(`${projectId}_${stage}.json`) || [];
}

export function setItems(projectId, stage, items) {
  writeJSON(`${projectId}_${stage}.json`, items);
  // Update project timestamp
  const projects = listProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx >= 0) {
    projects[idx].updatedAt = Date.now();
    writeJSON('_projects.json', projects);
  }
}

export function addItems(projectId, stage, newItems) {
  const existing = getItems(projectId, stage);
  const existingIds = new Set(existing.map(i => i.id));
  const toAdd = newItems.filter(i => !existingIds.has(i.id));
  const updated = [...existing, ...toAdd];
  setItems(projectId, stage, updated);
  return updated;
}

export function updateItem(projectId, stage, itemId, updates) {
  const items = getItems(projectId, stage);
  const idx = items.findIndex(i => i.id === itemId);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...updates, updatedAt: Date.now() };
  setItems(projectId, stage, items);
  return items[idx];
}

// ─── FEEDBACK / MEMORY ───
export function getFeedback(projectId) {
  return readJSON(`${projectId}_feedback.json`) || [];
}

export function addFeedback(projectId, entry) {
  const feedback = getFeedback(projectId);
  const enriched = {
    ...entry,
    id: entry.id || uuid(),
    timestamp: entry.timestamp || Date.now(),
  };
  feedback.push(enriched);
  writeJSON(`${projectId}_feedback.json`, feedback);

  // Update learned patterns
  updatePatterns(projectId, feedback);

  return enriched;
}

// ─── PATTERN LEARNING ───
export function getPatterns(projectId) {
  return readJSON(`${projectId}_patterns.json`) || { approved: [], rejected: [], rules: [] };
}

function updatePatterns(projectId, feedback) {
  const patterns = getPatterns(projectId);

  // Extract approval patterns
  const approvedItems = feedback.filter(f => f.action === 'approved');
  const rejectedItems = feedback.filter(f => f.action === 'rejected');
  const revisionItems = feedback.filter(f => f.action === 'revision');

  // Track what gets approved vs rejected
  patterns.approved = approvedItems.map(f => ({
    title: f.itemTitle,
    stage: f.stage,
    comment: f.comment,
    timestamp: f.timestamp,
  }));

  patterns.rejected = rejectedItems.map(f => ({
    title: f.itemTitle,
    stage: f.stage,
    comment: f.comment,
    timestamp: f.timestamp,
  }));

  // Extract rules from revision comments
  patterns.rules = revisionItems
    .filter(f => f.comment && f.comment.trim().length > 0)
    .map(f => ({
      from: f.itemTitle,
      rule: f.comment,
      timestamp: f.timestamp,
    }));

  writeJSON(`${projectId}_patterns.json`, patterns);
  return patterns;
}

// ─── CONTRADICTION DETECTION ───
export function findContradictions(projectId) {
  const feedback = getFeedback(projectId);
  const contradictions = [];

  // Group by item
  const byItem = {};
  feedback.forEach(e => {
    if (!byItem[e.itemId]) byItem[e.itemId] = [];
    byItem[e.itemId].push(e);
  });

  // Check direct contradictions (approved then rejected or vice versa)
  Object.values(byItem).forEach(entries => {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];
        if ((a.action === 'approved' && b.action === 'rejected') ||
            (a.action === 'rejected' && b.action === 'approved')) {
          contradictions.push({
            id: uuid(),
            type: 'direct',
            entry1: a,
            entry2: b,
            description: `You ${a.action} "${a.itemTitle}" then ${b.action} it. Which call do we go with?`,
          });
        }
      }
    }
  });

  // Check thematic contradictions from comments
  const commented = feedback.filter(e => e.comment);
  const themes = {};

  const themeKeywords = {
    shorter: ['too long', 'shorter', 'trim', 'cut down'],
    longer: ['too short', 'longer', 'expand', 'more detail'],
    lighter: ['too dark', 'lighter', 'softer', 'less edgy'],
    darker: ['darker', 'edgier', 'push it', 'more aggressive'],
    grounded: ['too absurd', 'too weird', 'more realistic', 'grounded'],
    absurd: ['more absurd', 'weirder', 'push further', 'too safe'],
  };

  commented.forEach(e => {
    const lower = e.comment.toLowerCase();
    Object.entries(themeKeywords).forEach(([theme, keywords]) => {
      if (keywords.some(kw => lower.includes(kw))) {
        if (!themes[theme]) themes[theme] = [];
        themes[theme].push(e);
      }
    });
  });

  const pairs = [['shorter', 'longer'], ['lighter', 'darker'], ['grounded', 'absurd']];
  pairs.forEach(([a, b]) => {
    if (themes[a]?.length && themes[b]?.length) {
      const e1 = themes[a][themes[a].length - 1];
      const e2 = themes[b][themes[b].length - 1];
      contradictions.push({
        id: uuid(),
        type: 'thematic',
        entry1: e1,
        entry2: e2,
        description: `Mixed signals: "${e1.comment?.substring(0, 60)}..." vs "${e2.comment?.substring(0, 60)}..." — help me calibrate.`,
      });
    }
  });

  return contradictions;
}

// ─── FULL CONTEXT FOR AI ───
// This is what gets sent to Claude so it has perfect memory
export function getFullContext(projectId) {
  const project = getProject(projectId);
  const feedback = getFeedback(projectId);
  const patterns = getPatterns(projectId);
  const strategies = getItems(projectId, 'strategies');
  const concepts = getItems(projectId, 'concepts');
  const scripts = getItems(projectId, 'scripts');
  const contradictions = findContradictions(projectId);

  return {
    project,
    strategies,
    concepts,
    scripts,
    feedback,
    patterns,
    contradictions,
    summary: {
      totalFeedback: feedback.length,
      approvedCount: feedback.filter(f => f.action === 'approved').length,
      rejectedCount: feedback.filter(f => f.action === 'rejected').length,
      revisionCount: feedback.filter(f => f.action === 'revision').length,
      activeContradictions: contradictions.length,
      learnedRules: patterns.rules.length,
    },
  };
}
