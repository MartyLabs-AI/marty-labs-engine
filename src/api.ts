// API client for Marty Labs Creative Engine

const BASE = '/api';

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ─── Projects ───
export const getProjects = () => request('/projects');
export const createProject = (name: string, brandData?: any) =>
  request('/projects', { method: 'POST', body: JSON.stringify({ name, brandData }) });
export const getProject = (id: string) => request(`/projects/${id}`);

// ─── Items ───
export const getItems = (projectId: string, stage: string) =>
  request(`/items/${projectId}/${stage}`);

// ─── Status / Feedback ───
export const updateStatus = (projectId: string, stage: string, itemId: string, status: string, comment?: string) =>
  request(`/items/${projectId}/${stage}/${itemId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, comment }),
  });

export const addComment = (projectId: string, stage: string, itemId: string, comment: string) =>
  request(`/items/${projectId}/${stage}/${itemId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });

// ─── Generation ───
export const generateStrategies = (projectId: string, count?: number, direction?: string) =>
  request('/generate/strategies', {
    method: 'POST',
    body: JSON.stringify({ projectId, count, direction }),
  });

export const generateConcepts = (projectId: string, count?: number, strategyId?: string, direction?: string) =>
  request('/generate/concepts', {
    method: 'POST',
    body: JSON.stringify({ projectId, count, strategyId, direction }),
  });

export const generateScript = (projectId: string, conceptId: string) =>
  request('/generate/scripts', {
    method: 'POST',
    body: JSON.stringify({ projectId, conceptId }),
  });

export const generateScriptsBatch = (projectId: string) =>
  request('/generate/scripts/batch', {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });

export const generateStoryboard = (projectId: string, scriptId: string) =>
  request('/images/storyboard', {
    method: 'POST',
    body: JSON.stringify({ projectId, scriptId }),
  });

export const generateStoryboardBatch = (projectId: string) =>
  request('/images/storyboard/batch', {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });

export const reframeImage = (projectId: string, storyboardId: string, frameId: string, direction?: string) =>
  request('/images/storyboard/reframe', {
    method: 'POST',
    body: JSON.stringify({ projectId, storyboardId, frameId, direction }),
  });

// ─── Iterate ───
export const iterate = (projectId: string, stage: string, itemId: string, direction?: string) =>
  request('/generate/iterate', {
    method: 'POST',
    body: JSON.stringify({ projectId, stage, itemId, direction }),
  });

// ─── Analysis ───
export const analyzeFeedback = (projectId: string) =>
  request('/generate/analyze-feedback', {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });

export const getFeedback = (projectId: string) => request(`/feedback/${projectId}`);
export const getContradictions = (projectId: string) => request(`/contradictions/${projectId}`);
export const getPatterns = (projectId: string) => request(`/patterns/${projectId}`);
export const getContext = (projectId: string) => request(`/context/${projectId}`);
export const healthCheck = () => request('/health');
