import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import * as store from '../memory/store.js';

const router = Router();

// ─── GET all items for a stage ───
router.get('/items/:projectId/:stage', (req, res) => {
  const { projectId, stage } = req.params;
  const items = store.getItems(projectId, stage);
  res.json({ items });
});

// ─── UPDATE item status (approve/reject/revision) ───
router.post('/items/:projectId/:stage/:itemId/status', (req, res) => {
  const { projectId, stage, itemId } = req.params;
  const { status, comment } = req.body;

  if (!['pending', 'approved', 'rejected', 'revision'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  // Update the item
  const items = store.getItems(projectId, stage);
  const item = items.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const updates = { status };
  if (comment) {
    updates.comments = [
      ...(item.comments || []),
      { id: uuid(), text: comment, timestamp: Date.now(), author: 'user' },
    ];
  }

  const updated = store.updateItem(projectId, stage, itemId, updates);

  // Record feedback
  store.addFeedback(projectId, {
    itemId,
    itemTitle: item.title,
    stage,
    action: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : status === 'revision' ? 'revision' : 'commented',
    comment: comment || undefined,
  });

  res.json({ item: updated });
});

// ─── ADD comment without changing status ───
router.post('/items/:projectId/:stage/:itemId/comment', (req, res) => {
  const { projectId, stage, itemId } = req.params;
  const { comment } = req.body;
  if (!comment?.trim()) return res.status(400).json({ error: 'Comment required' });

  const items = store.getItems(projectId, stage);
  const item = items.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const updated = store.updateItem(projectId, stage, itemId, {
    comments: [
      ...(item.comments || []),
      { id: uuid(), text: comment, timestamp: Date.now(), author: 'user' },
    ],
  });

  store.addFeedback(projectId, {
    itemId,
    itemTitle: item.title,
    stage,
    action: 'commented',
    comment,
  });

  res.json({ item: updated });
});

// ─── GET feedback history ───
router.get('/feedback/:projectId', (req, res) => {
  const { projectId } = req.params;
  const feedback = store.getFeedback(projectId);
  res.json({ feedback });
});

// ─── GET contradictions ───
router.get('/contradictions/:projectId', (req, res) => {
  const { projectId } = req.params;
  const contradictions = store.findContradictions(projectId);
  res.json({ contradictions });
});

// ─── GET learned patterns ───
router.get('/patterns/:projectId', (req, res) => {
  const { projectId } = req.params;
  const patterns = store.getPatterns(projectId);
  res.json({ patterns });
});

// ─── GET full project context (for debug / export) ───
router.get('/context/:projectId', (req, res) => {
  const { projectId } = req.params;
  const context = store.getFullContext(projectId);
  res.json(context);
});

// ─── PROJECT MANAGEMENT ───
router.get('/projects', (req, res) => {
  const projects = store.listProjects();
  res.json({ projects });
});

router.post('/projects', (req, res) => {
  const { name, brandData } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project name required' });
  const project = store.createProject(name.trim(), brandData || {});
  res.json({ project });
});

router.get('/projects/:projectId', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

export default router;
