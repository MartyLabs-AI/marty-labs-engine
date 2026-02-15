import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as api from './api';

// ─── TYPES ───
type Status = 'pending' | 'approved' | 'rejected' | 'revision';
type Stage = 'strategies' | 'concepts' | 'scripts' | 'storyboards';

interface Comment { id: string; text: string; timestamp: number; author: 'user' | 'system'; }
interface ScriptShot { time: string; label: string; desc: string; camera?: string; audio?: string; text_overlay?: string; }
interface StoryFrame { id: string; scene: string; description: string; imagePrompt?: string; imageUrl?: string | null; notes: string; status: Status; error?: string; }

interface PipelineItem {
  id: string; title: string; description: string; details?: string[];
  exampleConcepts?: string[];
  status: Status; comments: Comment[]; parentId?: string | null;
  tier?: string; format?: string; duration?: string; heroCopy?: string;
  script?: ScriptShot[]; hooks?: string[]; caption?: string;
  frames?: StoryFrame[]; productionNotes?: string;
}

interface FeedbackEntry {
  id: string; itemId: string; itemTitle: string; stage: string;
  action: string; comment?: string; timestamp: number;
}

interface Contradiction {
  id: string; type: string; entry1: FeedbackEntry; entry2: FeedbackEntry; description: string;
}

interface Project { id: string; name: string; brandData?: any; createdAt: number; }

// ─── HELPERS ───
function ftime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── BADGE COMPONENTS ───
function SBadge({ status }: { status: Status }) {
  const m: Record<Status, string> = {
    pending: 'bg-zinc-700 text-zinc-300',
    approved: 'bg-emerald-900/60 text-emerald-300 border border-emerald-600/40',
    rejected: 'bg-red-900/40 text-red-300 border border-red-700/30',
    revision: 'bg-amber-900/40 text-amber-300 border border-amber-600/30',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded ${m[status]}`}>{status}</span>;
}

function TBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  const c = tier === 'S' ? 'bg-[#39FF14]/20 text-[#39FF14] border-[#39FF14]/40'
    : tier === 'A' ? 'bg-lime-900/30 text-lime-300 border-lime-600/30'
    : 'bg-yellow-900/30 text-yellow-300 border-yellow-600/30';
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded border ${c}`}>{tier}</span>;
}

// ─── MAIN APP ───
export default function App() {
  // Project state
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');

  // Pipeline state
  const [stage, setStage] = useState<Stage>('strategies');
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState<Status | 'all'>('all');

  // Refs for stable access in callbacks (avoids stale closures)
  const stageRef = useRef<Stage>(stage);
  const projectIdRef = useRef<string | null>(projectId);
  stageRef.current = stage;
  projectIdRef.current = projectId;

  // Memory state
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [showMem, setShowMem] = useState(false);
  const [showContra, setShowContra] = useState<Contradiction | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Loading states
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genDirection, setGenDirection] = useState('');
  const [showGenPanel, setShowGenPanel] = useState(false);
  const [error, setError] = useState('');

  // Health
  const [health, setHealth] = useState<any>(null);

  // ─── EFFECTS ───
  useEffect(() => {
    api.healthCheck().then(setHealth).catch(() => setHealth({ status: 'error' }));
    api.getProjects().then(d => setProjects(d.projects)).catch(() => {});
  }, []);

  // Load items when project or stage changes
  const loadItems = useCallback(async (pid: string, stg: Stage) => {
    setLoading(true);
    setError('');
    try {
      const [itemsRes, fbRes, contraRes] = await Promise.all([
        api.getItems(pid, stg),
        api.getFeedback(pid),
        api.getContradictions(pid),
      ]);
      setItems(itemsRes.items || []);
      setFeedback(fbRes.feedback || []);
      setContradictions(contraRes.contradictions || []);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setSelId(null);
    loadItems(projectId, stage);
  }, [projectId, stage, loadItems]);

  // Derive selected item from items array by ID
  const selItem = useMemo(() => {
    if (!selId) return null;
    return items.find(i => i.id === selId) || null;
  }, [selId, items]);

  const filtered = useMemo(() =>
    filter === 'all' ? items : items.filter(i => i.status === filter)
  , [items, filter]);

  const stats = useMemo(() => ({
    total: items.length,
    approved: items.filter(i => i.status === 'approved').length,
    rejected: items.filter(i => i.status === 'rejected').length,
    revision: items.filter(i => i.status === 'revision').length,
    pending: items.filter(i => i.status === 'pending').length,
  }), [items]);

  // ─── ACTIONS (use refs for stage/projectId to avoid stale closures) ───
  const refreshItems = useCallback(async () => {
    const pid = projectIdRef.current;
    const stg = stageRef.current;
    if (!pid) return;
    const res = await api.getItems(pid, stg);
    setItems(res.items || []);
    const fbRes = await api.getFeedback(pid);
    setFeedback(fbRes.feedback || []);
    const cRes = await api.getContradictions(pid);
    setContradictions(cRes.contradictions || []);
  }, []);

  const doStatus = useCallback(async (itemId: string, status: Status, cmt?: string) => {
    const pid = projectIdRef.current;
    const stg = stageRef.current;
    if (!pid) return;
    try {
      await api.updateStatus(pid, stg, itemId, status, cmt || undefined);
      await refreshItems();
      setComment('');
    } catch (e: any) { setError(e.message); }
  }, [refreshItems]);

  const doComment = useCallback(async (itemId: string, text: string) => {
    const pid = projectIdRef.current;
    const stg = stageRef.current;
    if (!pid || !text.trim()) return;
    try {
      await api.addComment(pid, stg, itemId, text);
      await refreshItems();
      setComment('');
    } catch (e: any) { setError(e.message); }
  }, [refreshItems]);

  const doGenerate = useCallback(async (direction?: string) => {
    const pid = projectIdRef.current;
    const stg = stageRef.current;
    if (!pid) return;
    setGenerating(true);
    setError('');
    try {
      if (stg === 'strategies') {
        await api.generateStrategies(pid, 5, direction);
      } else if (stg === 'concepts') {
        // Get current items to find approved strategies
        const currentItems = await api.getItems(pid, 'strategies');
        const approvedStrategies = (currentItems.items || []).filter((i: any) => i.status === 'approved');
        const stratId = approvedStrategies.length > 0 ? approvedStrategies[0].id : undefined;
        await api.generateConcepts(pid, 5, stratId, direction);
      } else if (stg === 'scripts') {
        await api.generateScriptsBatch(pid);
      } else if (stg === 'storyboards') {
        await api.generateStoryboardBatch(pid);
      }
      await refreshItems();
      setShowGenPanel(false);
      setGenDirection('');
    } catch (e: any) { setError(e.message); }
    setGenerating(false);
  }, [refreshItems]);

  const doIterate = useCallback(async (itemId: string, direction?: string) => {
    const pid = projectIdRef.current;
    const stg = stageRef.current;
    if (!pid) return;
    setGenerating(true);
    try {
      await api.iterate(pid, stg, itemId, direction);
      await refreshItems();
    } catch (e: any) { setError(e.message); }
    setGenerating(false);
  }, [refreshItems]);

  const doAnalyze = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    setGenerating(true);
    try {
      const res = await api.analyzeFeedback(pid);
      setAnalysisText(res.analysis);
      setShowAnalysis(true);
    } catch (e: any) { setError(e.message); }
    setGenerating(false);
  }, []);

  const doCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    try {
      const res = await api.createProject(newProjectName.trim());
      setProjects(p => [...p, res.project]);
      setProjectId(res.project.id);
      setNewProjectName('');
    } catch (e: any) { setError(e.message); }
  }, [newProjectName]);

  const stageConf: Record<Stage, { label: string; icon: string; desc: string }> = {
    strategies: { label: 'Strategy', icon: '\u{1F4CA}', desc: 'Approve strategic directions' },
    concepts: { label: 'Concepts', icon: '\u{1F4A1}', desc: 'Review creative concepts' },
    scripts: { label: 'Scripts', icon: '\u{1F4DD}', desc: 'Finalize shot lists' },
    storyboards: { label: 'Storyboard', icon: '\u{1F3AC}', desc: 'Visual frame review' },
  };

  // ─── PROJECT SELECTION SCREEN ───
  if (!projectId) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0e' }}>
        <div className="w-full max-w-md p-8">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold mb-1" style={{ color: '#39FF14' }}>MARTY LABS</h1>
            <p className="text-sm" style={{ color: '#666' }}>Creative Engine</p>
            {health && (
              <div className="mt-3 flex justify-center gap-3 text-[10px]">
                <span style={{ color: health.hasAnthropicKey ? '#39FF14' : '#ff4444' }}>
                  {health.hasAnthropicKey ? '\u25CF Claude' : '\u25CB Claude (no key)'}
                </span>
                <span style={{ color: health.hasReplicateKey ? '#39FF14' : '#ff4444' }}>
                  {health.hasReplicateKey ? '\u25CF Flux' : '\u25CB Flux (no key)'}
                </span>
              </div>
            )}
          </div>

          {projects.length > 0 && (
            <div className="mb-6">
              <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#555' }}>Existing Projects</p>
              <div className="space-y-2">
                {projects.map(p => (
                  <button key={p.id} onClick={() => setProjectId(p.id)}
                    className="w-full text-left p-3 rounded-lg transition-all hover:border-[#39FF14]/30"
                    style={{ background: '#111115', border: '1px solid #1a1a22' }}>
                    <span className="text-sm font-medium" style={{ color: '#e5e5e5' }}>{p.name}</span>
                    <span className="text-[10px] ml-2" style={{ color: '#555' }}>
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: '#555' }}>New Project</p>
            <div className="flex gap-2">
              <input
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doCreateProject()}
                placeholder="e.g. Matiks Q1 Campaign"
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: '#111115', border: '1px solid #1a1a22', color: '#e5e5e5' }}
              />
              <button onClick={doCreateProject}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: '#39FF14', color: '#000' }}>
                Create
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── MAIN DASHBOARD ───
  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0a0a0e' }}>
      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 text-xs flex items-center justify-between" style={{ background: '#331111', color: '#ff6666', borderBottom: '1px solid #441111' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-4 opacity-60 hover:opacity-100">{'\u2715'}</button>
        </div>
      )}

      {/* TOP BAR */}
      <header className="flex-shrink-0" style={{ borderBottom: '1px solid #1a1a22', background: 'rgba(15,15,20,0.5)' }}>
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => { setProjectId(null); setSelId(null); }} className="hover:opacity-80">
              <span style={{ color: '#39FF14' }} className="font-bold text-lg tracking-tight">MARTY LABS</span>
            </button>
            <div className="w-px h-5" style={{ background: '#1a1a22' }} />
            <span className="text-sm" style={{ color: '#555' }}>Creative Engine</span>
          </div>
          <div className="flex items-center gap-2">
            {generating && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs animate-pulse-green"
                style={{ background: 'rgba(57,255,20,0.05)', color: '#39FF14', border: '1px solid rgba(57,255,20,0.2)' }}>
                <span className="spinner" /> Generating...
              </div>
            )}
            {contradictions.length > 0 && (
              <button onClick={() => setShowContra(contradictions[0])}
                className="px-3 py-1.5 rounded-md text-xs font-medium"
                style={{ border: '1px solid rgba(255,200,50,0.3)', color: '#ffcc66', background: 'rgba(255,200,50,0.05)' }}>
                {'\u26A0'} {contradictions.length} contradiction{contradictions.length > 1 ? 's' : ''}
              </button>
            )}
            <button onClick={doAnalyze} disabled={generating}
              className="px-3 py-1.5 rounded-md text-xs font-medium"
              style={{ border: '1px solid #1a1a22', color: '#B8A9C9' }}>
              {'\u{1F4CA}'} Insights
            </button>
            <button onClick={() => setShowMem(true)}
              className="px-3 py-1.5 rounded-md text-xs font-medium"
              style={{ border: '1px solid #1a1a22', color: '#999' }}>
              {'\u{1F9E0}'} Memory ({feedback.length})
            </button>
          </div>
        </div>

        {/* Pipeline stages */}
        <div className="px-5 pb-3 flex items-center gap-1">
          {(['strategies', 'concepts', 'scripts', 'storyboards'] as Stage[]).map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <button
                onClick={() => { setStage(s); setSelId(null); setFilter('all'); }}
                className="flex-1 rounded-md px-3 py-2 text-left transition-all"
                style={{
                  background: stage === s ? '#151518' : 'transparent',
                  boxShadow: stage === s ? 'inset 0 0 0 1px rgba(57,255,20,0.2)' : 'none',
                }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium" style={{ color: stage === s ? '#39FF14' : '#555' }}>
                    {stageConf[s].icon} {stageConf[s].label}
                  </span>
                </div>
              </button>
              {i < 3 && <span className="mx-1 text-xs" style={{ color: '#2a2a2a' }}>{'\u2192'}</span>}
            </div>
          ))}
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        {/* List panel */}
        <div className="w-[400px] flex-shrink-0 flex flex-col" style={{ borderRight: '1px solid #1a1a22' }}>
          <div className="p-4" style={{ borderBottom: '1px solid #1a1a22' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm" style={{ color: '#e5e5e5' }}>
                {stageConf[stage].icon} {stageConf[stage].label}
              </h2>
              <div className="flex gap-1.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(50,180,80,0.15)', color: '#55cc77' }}>{stats.approved}{'\u2713'}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(200,180,50,0.15)', color: '#ccaa55' }}>{stats.revision}{'\u21BB'}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(100,100,100,0.15)', color: '#888' }}>{stats.pending}{'\u25CB'}</span>
              </div>
            </div>
            <div className="flex gap-1 mb-3">
              {(['all', 'pending', 'approved', 'revision', 'rejected'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className="text-[10px] px-2 py-1 rounded transition-colors"
                  style={{ background: filter === f ? '#151518' : 'transparent', color: filter === f ? '#e5e5e5' : '#555' }}>
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={() => setShowGenPanel(true)} disabled={generating}
              className="w-full px-3 py-2 rounded-md text-xs font-medium transition-all"
              style={{ background: generating ? '#1a1a22' : '#39FF14', color: generating ? '#555' : '#000' }}>
              {generating ? <><span className="spinner mr-2" /> Generating...</> : `+ Generate ${stageConf[stage].label}`}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <span className="spinner" />
              </div>
            ) : (
              <div className="p-3 space-y-1.5">
                {filtered.length === 0 && (
                  <p className="text-sm text-center py-12" style={{ color: '#555' }}>
                    {items.length === 0 ? `No ${stage} yet. Click generate above.` : 'No items match filter.'}
                  </p>
                )}
                {filtered.map(item => (
                  <button key={item.id} onClick={() => { setSelId(item.id); setComment(''); }}
                    className="w-full text-left rounded-lg p-3 transition-all animate-fade-in"
                    style={{
                      background: selId === item.id ? 'rgba(57,255,20,0.04)' : 'transparent',
                      border: selId === item.id ? '1px solid rgba(57,255,20,0.25)' : '1px solid transparent',
                    }}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-medium text-sm leading-tight" style={{ color: '#e5e5e5' }}>{item.title}</span>
                      <div className="flex gap-1 flex-shrink-0"><TBadge tier={item.tier} /><SBadge status={item.status} /></div>
                    </div>
                    <p className="text-xs leading-relaxed line-clamp-2" style={{ color: '#666' }}>{item.description}</p>
                    {(item.comments?.length || 0) > 0 && (
                      <div className="mt-1.5 text-[10px]" style={{ color: '#555' }}>{'\u{1F4AC}'} {item.comments.length}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selItem ? (
            <>
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 animate-fade-in">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <TBadge tier={selItem.tier} />
                        <h1 className="text-xl font-bold" style={{ color: '#e5e5e5' }}>{selItem.title}</h1>
                      </div>
                      {selItem.format && (
                        <p className="text-xs" style={{ color: '#666' }}>
                          {selItem.format} {'\u00B7'} {selItem.duration} {'\u00B7'} End card: &quot;{selItem.heroCopy || 'The smarter screen time.'}&quot;
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <SBadge status={selItem.status} />
                      {selItem.status === 'revision' && (
                        <button onClick={() => doIterate(selItem.id, comment || undefined)} disabled={generating}
                          className="px-2 py-1 rounded text-[10px] font-medium"
                          style={{ background: 'rgba(184,169,201,0.15)', color: '#B8A9C9', border: '1px solid rgba(184,169,201,0.3)' }}>
                          {generating ? <span className="spinner" /> : '\u{1F504} AI Iterate'}
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-sm leading-relaxed mb-6" style={{ color: '#ccc' }}>{selItem.description}</p>

                  {selItem.details && selItem.details.length > 0 && (
                    <div className="mb-6 space-y-2">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#555' }}>Key Points</h3>
                      {selItem.details.map((d, i) => (
                        <div key={i} className="flex gap-2 text-sm">
                          <span style={{ color: '#39FF14' }} className="mt-0.5">{'\u25B8'}</span>
                          <span style={{ color: '#999' }}>{d}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Example Concepts (for strategies) */}
                  {selItem.exampleConcepts && selItem.exampleConcepts.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#555' }}>Example Concepts</h3>
                      <div className="space-y-1.5">
                        {selItem.exampleConcepts.map((ec, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-xs font-bold mt-0.5" style={{ color: '#B8A9C9' }}>{'\u{1F4A1}'}</span>
                            <span style={{ color: '#999' }}>{ec}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selItem.script && Array.isArray(selItem.script) && (
                    <div className="mb-6">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#555' }}>Shot List</h3>
                      <div className="space-y-2">
                        {selItem.script.map((shot, i) => (
                          <div key={i} className="flex gap-3 p-3 rounded-md" style={{ background: '#111115', border: '1px solid #1a1a22' }}>
                            <span className="text-[10px] font-mono whitespace-nowrap mt-0.5" style={{ color: '#39FF14' }}>{shot.time}</span>
                            <div className="flex-1">
                              <span className="text-xs font-semibold" style={{ color: '#e5e5e5' }}>{shot.label}</span>
                              <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#888' }}>{shot.desc}</p>
                              {shot.camera && <p className="text-[10px] mt-1" style={{ color: '#555' }}>{'\u{1F4F7}'} {shot.camera}</p>}
                              {shot.audio && <p className="text-[10px]" style={{ color: '#555' }}>{'\u{1F50A}'} {shot.audio}</p>}
                              {shot.text_overlay && <p className="text-[10px]" style={{ color: '#B8A9C9' }}>{'\u{1F4DD}'} &quot;{shot.text_overlay}&quot;</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {selItem.productionNotes && (
                        <div className="mt-3 p-3 rounded-md text-xs" style={{ background: 'rgba(184,169,201,0.05)', border: '1px solid rgba(184,169,201,0.15)', color: '#B8A9C9' }}>
                          <strong>Production Notes:</strong> {selItem.productionNotes}
                        </div>
                      )}
                    </div>
                  )}

                  {selItem.hooks && selItem.hooks.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#555' }}>Hook Variations</h3>
                      {selItem.hooks.map((h, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm mb-1.5">
                          <span className="text-xs font-bold mt-0.5" style={{ color: '#B8A9C9' }}>{String.fromCharCode(65 + i)}.</span>
                          <span className="italic" style={{ color: '#999' }}>&quot;{h}&quot;</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {selItem.caption && (
                    <div className="mb-6">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#555' }}>IG Caption</h3>
                      <div className="p-3 rounded-md text-sm whitespace-pre-line italic leading-relaxed"
                        style={{ background: '#111115', border: '1px solid #1a1a22', color: '#999' }}>
                        {selItem.caption}
                      </div>
                    </div>
                  )}

                  {selItem.frames && selItem.frames.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#555' }}>Storyboard Frames</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {selItem.frames.map((fr, i) => (
                          <div key={fr.id} className="rounded-lg overflow-hidden" style={{ border: '1px solid #1a1a22' }}>
                            <div className="aspect-video flex items-center justify-center overflow-hidden"
                              style={{ background: '#111115', borderBottom: '1px solid #1a1a22' }}>
                              {fr.imageUrl ? (
                                <img src={fr.imageUrl} alt={fr.scene} className="w-full h-full object-cover" />
                              ) : fr.error ? (
                                <div className="text-center p-3">
                                  <span className="text-[10px]" style={{ color: '#ff4444' }}>Generation failed</span>
                                </div>
                              ) : (
                                <div className="text-center p-3">
                                  <span className="text-2xl block mb-1">{'\u{1F3AC}'}</span>
                                  <span className="text-[10px]" style={{ color: '#555' }}>Frame {i + 1}: {fr.scene}</span>
                                </div>
                              )}
                            </div>
                            <div className="p-2.5">
                              <p className="text-xs leading-relaxed" style={{ color: '#999' }}>{fr.description}</p>
                              <p className="text-[10px] mt-1" style={{ color: '#555' }}>{fr.notes}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(selItem.comments?.length || 0) > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#555' }}>
                        Feedback ({selItem.comments.length})
                      </h3>
                      <div className="space-y-2">
                        {selItem.comments.map(c => (
                          <div key={c.id} className="flex gap-2 p-2.5 rounded-md"
                            style={{ background: 'rgba(17,17,21,0.6)', border: '1px solid rgba(26,26,34,0.3)' }}>
                            <span className="text-xs mt-0.5">{c.author === 'user' ? '\u{1F464}' : '\u{1F916}'}</span>
                            <div className="flex-1">
                              <p className="text-xs" style={{ color: '#999' }}>{c.text}</p>
                              <span className="text-[10px]" style={{ color: '#444' }}>{ftime(c.timestamp)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action bar */}
              <div className="flex-shrink-0 p-4" style={{ borderTop: '1px solid #1a1a22', background: 'rgba(15,15,20,0.5)' }}>
                <textarea value={comment} onChange={e => setComment(e.target.value)}
                  placeholder="Add feedback, notes, or direction..."
                  rows={2}
                  className="w-full mb-3 p-3 rounded-md text-sm resize-none outline-none"
                  style={{ background: '#111115', border: '1px solid #1a1a22', color: '#ccc' }}
                  onKeyDown={e => { if (e.key === 'Enter' && e.metaKey && selItem) doComment(selItem.id, comment); }}
                />
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <button onClick={() => selItem && doStatus(selItem.id, 'approved', comment || undefined)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium"
                      style={{ background: 'hsl(150,50%,25%)', color: 'hsl(150,60%,80%)' }}>{'\u2713'} Approve</button>
                    <button onClick={() => selItem && doStatus(selItem.id, 'revision', comment || undefined)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium"
                      style={{ border: '1px solid rgba(200,180,50,0.3)', color: '#ccaa55', background: 'rgba(200,180,50,0.05)' }}>{'\u21BB'} Revision</button>
                    <button onClick={() => selItem && doStatus(selItem.id, 'rejected', comment || undefined)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium"
                      style={{ border: '1px solid rgba(200,50,50,0.3)', color: '#cc5555', background: 'rgba(200,50,50,0.05)' }}>{'\u2717'} Reject</button>
                  </div>
                  <div className="flex gap-2">
                    {comment.trim() && (
                      <button onClick={() => selItem && doComment(selItem.id, comment)}
                        className="text-xs px-3 py-1.5 rounded-md" style={{ color: '#888' }}>{'\u{1F4AC}'} Comment only</button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <span className="text-4xl mb-4 block">{stageConf[stage].icon}</span>
                <p className="text-sm mb-1" style={{ color: '#666' }}>{stageConf[stage].desc}</p>
                <p className="text-xs" style={{ color: '#444' }}>Select an item to review</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── GENERATE PANEL (modal) ─── */}
      {showGenPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowGenPanel(false)}>
          <div className="rounded-lg w-full max-w-md p-5" style={{ background: '#111115', border: '1px solid #1a1a22' }} onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold mb-4" style={{ color: '#e5e5e5' }}>
              Generate {stageConf[stage].label}
            </h2>
            <p className="text-xs mb-4" style={{ color: '#888' }}>
              {stage === 'strategies' && 'Claude will generate 5 fresh strategy pillars based on brand context + all your feedback history.'}
              {stage === 'concepts' && 'Claude will generate 5 creative concepts. It remembers every approval, rejection, and comment you have made.'}
              {stage === 'scripts' && 'Claude will write detailed shot-by-shot scripts for all approved concepts that do not have scripts yet.'}
              {stage === 'storyboards' && 'Claude will create image prompts, then Flux will generate storyboard frames for all approved scripts.'}
            </p>
            {(stage === 'strategies' || stage === 'concepts') && (
              <textarea
                value={genDirection}
                onChange={e => setGenDirection(e.target.value)}
                placeholder="Optional: give direction (e.g. more dark humor or focus on relatable scenarios)..."
                rows={3}
                className="w-full mb-4 p-3 rounded-md text-sm resize-none outline-none"
                style={{ background: '#0a0a0e', border: '1px solid #1a1a22', color: '#ccc' }}
              />
            )}
            <div className="flex gap-2">
              <button onClick={() => doGenerate(genDirection || undefined)} disabled={generating}
                className="flex-1 py-2 rounded-md text-sm font-medium"
                style={{ background: generating ? '#1a1a22' : '#39FF14', color: generating ? '#555' : '#000' }}>
                {generating ? <><span className="spinner mr-2" /> Generating...</> : 'Generate with Claude Opus'}
              </button>
              <button onClick={() => setShowGenPanel(false)}
                className="px-4 py-2 rounded-md text-sm" style={{ background: '#1a1a22', color: '#888' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MEMORY DIALOG ─── */}
      {showMem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowMem(false)}>
          <div className="rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col" style={{ background: '#111115', border: '1px solid #1a1a22' }}
            onClick={e => e.stopPropagation()}>
            <div className="p-4" style={{ borderBottom: '1px solid #1a1a22' }}>
              <h2 className="font-semibold flex items-center gap-2" style={{ color: '#e5e5e5' }}>{'\u{1F9E0}'} Decision Memory</h2>
              <p className="text-[10px] mt-1" style={{ color: '#555' }}>
                Every decision is stored permanently and fed to Claude when generating new content.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {feedback.length === 0 && <p className="text-sm text-center py-6" style={{ color: '#555' }}>No decisions yet.</p>}
              {[...feedback].reverse().map(e => (
                <div key={e.id} className="p-3 rounded-md" style={{ border: '1px solid rgba(26,26,34,0.5)', background: 'rgba(17,17,21,0.3)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs">{e.action === 'approved' ? '\u2705' : e.action === 'rejected' ? '\u274C' : e.action === 'revision' ? '\u{1F504}' : '\u{1F4AC}'}</span>
                    <span className="text-xs font-medium" style={{ color: '#ccc' }}>{e.itemTitle}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: '#1a1a22', color: '#666' }}>{e.stage}</span>
                    <span className="text-[10px] ml-auto" style={{ color: '#444' }}>{ftime(e.timestamp)}</span>
                  </div>
                  {e.comment && <p className="text-xs pl-5 leading-relaxed" style={{ color: '#888' }}>&quot;{e.comment}&quot;</p>}
                </div>
              ))}
            </div>
            <div className="p-3" style={{ borderTop: '1px solid #1a1a22' }}>
              <button onClick={() => setShowMem(false)} className="w-full py-2 rounded-md text-xs" style={{ background: '#1a1a22', color: '#888' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CONTRADICTION DIALOG ─── */}
      {showContra && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowContra(null)}>
          <div className="rounded-lg w-full max-w-md p-5" style={{ background: '#111115', border: '1px solid rgba(255,200,50,0.3)' }}
            onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: '#ffcc66' }}>{'\u26A0'} Feedback Contradiction</h2>
            <p className="text-sm mb-4" style={{ color: '#ccc' }}>{showContra.description}</p>
            <div className="space-y-2 mb-4">
              {[showContra.entry1, showContra.entry2].map((entry, idx) => (
                <div key={idx} className="p-2.5 rounded" style={{ background: '#0a0a0e', border: '1px solid #1a1a22' }}>
                  <p className="text-xs" style={{ color: '#888' }}>
                    Decision {idx + 1}: <strong style={{ color: '#ccc' }}>{entry.action}</strong> on &quot;{entry.itemTitle}&quot;
                  </p>
                  {entry.comment && <p className="text-xs mt-1" style={{ color: '#666' }}>&quot;{entry.comment}&quot;</p>}
                </div>
              ))}
            </div>
            <button onClick={() => setShowContra(null)}
              className="w-full py-2 rounded-md text-xs"
              style={{ background: '#1a1a22', color: '#888', border: '1px solid #1a1a22' }}>
              Acknowledge & Continue
            </button>
          </div>
        </div>
      )}

      {/* ─── ANALYSIS DIALOG ─── */}
      {showAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowAnalysis(false)}>
          <div className="rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col" style={{ background: '#111115', border: '1px solid rgba(184,169,201,0.3)' }}
            onClick={e => e.stopPropagation()}>
            <div className="p-4" style={{ borderBottom: '1px solid #1a1a22' }}>
              <h2 className="font-semibold flex items-center gap-2" style={{ color: '#B8A9C9' }}>{'\u{1F4CA}'} Feedback Analysis</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="prose prose-invert text-sm whitespace-pre-wrap" style={{ color: '#ccc' }}>{analysisText}</div>
            </div>
            <div className="p-3" style={{ borderTop: '1px solid #1a1a22' }}>
              <button onClick={() => setShowAnalysis(false)} className="w-full py-2 rounded-md text-xs" style={{ background: '#1a1a22', color: '#888' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
