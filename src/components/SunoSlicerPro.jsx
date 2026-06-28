import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Upload, Play, Pause, Trash2, Download, ZoomIn, ZoomOut,
  SkipBack, Scissors, VolumeX, X, Plus, Headphones, Cpu, Loader,
} from "lucide-react";
import TrackWaveform from "./TrackWaveform";
import { formatTime, mixAndExport } from "../utils/audio";
import { TRACK_COLORS, STEM_ORDER, guessStemName } from "../utils/constants";
import { getServerInfo, startSeparation, checkStatus, fetchStem, listJobs } from "../utils/api";

function Spinner({ size = 20 }) {
  return (
    <div style={{ width: size, height: size, border: `2px solid rgba(99,102,241,0.2)`, borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

export default function SunoSlicerPro() {
  const [serverInfo, setServerInfo] = useState(null);
  const [serverError, setServerError] = useState(false);
  const [separating, setSeparating] = useState(false);
  const [sepJobId, setSepJobId] = useState(null);
  const [sepStatus, setSepStatus] = useState(null);
  const [sepModel, setSepModel] = useState("htdemucs_ft");
  const [uploadingFile, setUploadingFile] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const [loadingJobId, setLoadingJobId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [exporting, setExporting] = useState(false);

  const ctxRef = useRef(null);
  const sourcesRef = useRef([]);
  const rafRef = useRef(null);
  const playCtxStart = useRef(0);
  const playOffset = useRef(0);
  const nextId = useRef(0);
  const nextRid = useRef(0);
  const pollRef = useRef(null);

  const dur = useMemo(() => Math.max(0, ...tracks.map(t => t.audioBuffer?.duration || 0)), [tracks]);
  const sampleRate = useMemo(() => tracks[0]?.audioBuffer?.sampleRate || 44100, [tracks]);
  const viewDur = dur / zoom || 1;
  const anySoloed = tracks.some(t => t.solo);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (ctxRef.current.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const jobs = await listJobs();
      setRecentJobs(jobs.filter(j => j.status === "complete" && j.stems?.length));
    } catch (e) { /* server may be offline; leave list as-is */ }
  }, []);

  useEffect(() => {
    getServerInfo().then(info => { setServerInfo(info); setServerError(false); }).catch(() => setServerError(true));
    refreshJobs();
  }, [refreshJobs]);

  const handleSeparate = useCallback(async (file) => {
    if (!file) return;
    setUploadingFile(file.name);
    setSeparating(true);
    setSepStatus({ status: "uploading", progress: "Uploading..." });
    try {
      const result = await startSeparation(file, sepModel);
      setSepJobId(result.job_id);
      setSepStatus({ status: "queued", progress: "Queued — waiting for AI model..." });
    } catch (e) {
      setSepStatus({ status: "error", error: e.message });
      setSeparating(false);
    }
  }, [sepModel]);

  useEffect(() => {
    if (!sepJobId || !separating) return;
    const poll = async () => {
      try {
        const status = await checkStatus(sepJobId);
        setSepStatus(status);
        if (status.status === "complete") { setSeparating(false); await loadStemsFromJob(sepJobId, status.stems); refreshJobs(); }
        else if (status.status === "error") { setSeparating(false); }
      } catch (e) {}
    };
    pollRef.current = setInterval(poll, 1500);
    poll();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sepJobId, separating]);

  const loadStemsFromJob = useCallback(async (jobId, stemNames) => {
    const ac = getCtx();
    const newTracks = [];
    const sorted = [...stemNames].sort((a, b) => {
      const ai = STEM_ORDER.indexOf(a); const bi = STEM_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    for (let i = 0; i < sorted.length; i++) {
      const name = sorted[i];
      try {
        const arrayBuf = await fetchStem(jobId, name);
        const decoded = await ac.decodeAudioData(arrayBuf);
        const id = ++nextId.current;
        newTracks.push({ id, name: name.charAt(0).toUpperCase() + name.slice(1), fileName: `${name}.wav`, audioBuffer: decoded, volume: 1, muted: false, solo: false, regions: [], color: i % TRACK_COLORS.length });
      } catch (e) { console.error(`Failed to load stem: ${name}`, e); }
    }
    setTracks(newTracks);
    if (newTracks.length > 0) setActiveId(newTracks[0].id);
    setCurTime(0); setZoom(1); setViewStart(0);
  }, [getCtx]);

  const loadJob = useCallback(async (job) => {
    setLoadingJobId(job.job_id);
    try {
      await loadStemsFromJob(job.job_id, job.stems);
    } finally {
      setLoadingJobId(null);
    }
  }, [loadStemsFromJob]);

  const addFiles = useCallback(async (files) => {
    const ac = getCtx();
    const newTracks = [];
    for (const file of files) {
      try {
        const ab = await file.arrayBuffer();
        const decoded = await ac.decodeAudioData(ab);
        const id = ++nextId.current;
        newTracks.push({ id, name: guessStemName(file.name), fileName: file.name, audioBuffer: decoded, volume: 1, muted: false, solo: false, regions: [], color: (tracks.length + newTracks.length) % TRACK_COLORS.length });
      } catch (e) { console.error("Decode failed:", file.name, e); }
    }
    setTracks(prev => [...prev, ...newTracks]);
    if (!activeId && newTracks.length > 0) setActiveId(newTracks[0].id);
  }, [getCtx, tracks.length, activeId]);

  const onDrop = useCallback((e) => { e.preventDefault(); const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith("audio/") || f.name.match(/\.(mp3|wav|m4a|ogg|flac|webm|aac)$/i)); if (files.length) addFiles(files); }, [addFiles]);
  const onFileInput = useCallback((e) => { const files = [...(e.target.files || [])]; if (files.length) addFiles(files); e.target.value = ""; }, [addFiles]);
  const removeTrack = useCallback((id) => { setTracks(prev => prev.filter(t => t.id !== id)); if (activeId === id) setActiveId(null); }, [activeId]);
  const toggleMute = useCallback((id) => { setTracks(prev => prev.map(t => t.id === id ? { ...t, muted: !t.muted } : t)); }, []);
  const toggleSolo = useCallback((id) => { setTracks(prev => prev.map(t => t.id === id ? { ...t, solo: !t.solo } : t)); }, []);
  const setVolume = useCallback((id, vol) => { setTracks(prev => prev.map(t => t.id === id ? { ...t, volume: vol } : t)); }, []);
  const addRegion = useCallback((trackId, start, end) => { const rid = ++nextRid.current; setTracks(prev => prev.map(t => t.id === trackId ? { ...t, regions: [...t.regions, { id: rid, start, end }] } : t)); }, []);
  const deleteRegion = useCallback((trackId, regionId) => { setTracks(prev => prev.map(t => t.id === trackId ? { ...t, regions: t.regions.filter(r => r.id !== regionId) } : t)); }, []);

  const stopPlayback = useCallback(() => { for (const s of sourcesRef.current) { try { s.stop(); } catch {} } sourcesRef.current = []; if (rafRef.current) cancelAnimationFrame(rafRef.current); setPlaying(false); }, []);

  const startPlayback = useCallback((fromTime) => {
    if (tracks.length === 0) return;
    stopPlayback();
    const ac = getCtx();
    const sources = [];
    for (const track of tracks) {
      if (!track.audioBuffer) continue;
      const src = ac.createBufferSource();
      src.buffer = track.audioBuffer;
      const gain = ac.createGain();
      const eff = track.muted ? 0 : (anySoloed && !track.solo) ? 0 : track.volume;
      gain.gain.setValueAtTime(eff, ac.currentTime);
      if (track.regions.length > 0 && eff > 0) {
        for (const r of [...track.regions].sort((a, b) => a.start - b.start)) {
          if (r.end <= fromTime) continue;
          const rStart = Math.max(r.start, fromTime);
          const now = ac.currentTime;
          gain.gain.setValueAtTime(eff, now + (rStart - fromTime) - 0.003);
          gain.gain.linearRampToValueAtTime(0, now + (rStart - fromTime));
          gain.gain.setValueAtTime(0, now + (r.end - fromTime) - 0.003);
          gain.gain.linearRampToValueAtTime(eff, now + (r.end - fromTime));
        }
      }
      src.connect(gain).connect(ac.destination);
      src.start(0, fromTime);
      sources.push(src);
    }
    sourcesRef.current = sources;
    playCtxStart.current = ac.currentTime;
    playOffset.current = fromTime;
    setPlaying(true);
    if (sources.length > 0) sources[0].onended = () => { setPlaying(false); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    const tick = () => { const ct = playOffset.current + (ac.currentTime - playCtxStart.current); if (ct >= dur) { setCurTime(dur); setPlaying(false); return; } setCurTime(ct); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
  }, [tracks, dur, getCtx, stopPlayback, anySoloed]);

  const togglePlay = useCallback(() => { if (playing) stopPlayback(); else startPlayback(curTime >= dur - 0.05 ? 0 : curTime); }, [playing, curTime, dur, startPlayback, stopPlayback]);
  const seek = useCallback((t) => { setCurTime(t); if (playing) startPlayback(t); }, [playing, startPlayback]);
  const restart = useCallback(() => { stopPlayback(); setCurTime(0); }, [stopPlayback]);
  const zoomIn = () => { const nz = Math.min(zoom * 1.5, 200); const c = viewStart + viewDur / 2; const nv = dur / nz; setZoom(nz); setViewStart(Math.max(0, Math.min(dur - nv, c - nv / 2))); };
  const zoomOut = () => { const nz = Math.max(zoom / 1.5, 1); const c = viewStart + viewDur / 2; const nv = dur / nz; setZoom(nz); setViewStart(nz <= 1 ? 0 : Math.max(0, Math.min(dur - nv, c - nv / 2))); };
  const zoomFit = () => { setZoom(1); setViewStart(0); };

  const handleExport = useCallback(() => {
    if (tracks.length === 0) return;
    setExporting(true);
    setTimeout(() => {
      try { const blob = mixAndExport(tracks, dur, sampleRate); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "suno_mix_edited.wav"; a.click(); URL.revokeObjectURL(url); } catch (e) { alert("Export failed: " + e.message); }
      setExporting(false);
    }, 50);
  }, [tracks, dur, sampleRate]);

  useEffect(() => { const onKey = (e) => { if (tracks.length === 0) return; if (e.code === "Space") { e.preventDefault(); togglePlay(); } if (e.code === "Home") { e.preventDefault(); restart(); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [tracks, togglePlay, restart]);

  const resetAll = useCallback(() => { stopPlayback(); setTracks([]); setActiveId(null); setCurTime(0); setSeparating(false); setSepJobId(null); setSepStatus(null); setUploadingFile(null); }, [stopPlayback]);

  const activeTrack = tracks.find(t => t.id === activeId);

  const S = {
    root: { background: "#08080f", color: "#e0e0ec", minHeight: "100vh", fontFamily: "'Inter',system-ui,sans-serif", fontSize: 13 },
    header: { padding: "16px 20px 8px", display: "flex", alignItems: "center", gap: 10 },
    logoBox: { width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#22d3ee)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
    title: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" },
    sub: { fontSize: 10, color: "#6b7280", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" },
    body: { padding: "0 16px 20px" },
    btn: (active) => ({ border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, background: active ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)", color: active ? "#a5b4fc" : "#999", transition: "all 0.12s" }),
    primaryBtn: { border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, background: "#6366f1", color: "#fff", transition: "all 0.15s" },
    sBtn: (active, bg) => ({ border: "none", borderRadius: 4, padding: "3px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer", background: active ? (bg || "rgba(99,102,241,0.3)") : "rgba(255,255,255,0.06)", color: active ? "#fff" : "#888", transition: "all 0.12s", display: "inline-flex", alignItems: "center", gap: 3 }),
    trackRow: (active, c) => ({ background: active ? c.bg : "rgba(255,255,255,0.015)", border: `1px solid ${active ? c.border : "rgba(255,255,255,0.04)"}`, borderRadius: 10, padding: "8px 10px", marginBottom: 6, cursor: "pointer" }),
    section: { marginTop: 10, padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)" },
    sectionTitle: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#666", marginBottom: 6 },
  };

  if (tracks.length === 0 && !separating) {
    const aiReady = serverInfo && serverInfo.demucs_installed && !serverError;
    return (
      <div style={S.root}>
        <div style={S.header}><div style={S.logoBox}><Scissors size={16} color="#fff" /></div><div><div style={S.title}>SunoSlicer Pro</div><div style={S.sub}>AI-Powered Stem Editor</div></div></div>
        <div style={S.body}>
          <div style={{ border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: "28px 24px", background: "rgba(99,102,241,0.04)", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Cpu size={18} color="#6366f1" />
              <span style={{ fontSize: 15, fontWeight: 700 }}>AI Stem Separation</span>
              {aiReady && <span style={{ fontSize: 10, background: "rgba(34,197,94,0.15)", color: "#22c55e", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>Ready</span>}
              {serverError && <span style={{ fontSize: 10, background: "rgba(239,68,68,0.15)", color: "#ef4444", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>Server Offline</span>}
            </div>
            {aiReady ? (<>
              <p style={{ color: "#9ca3af", fontSize: 12, lineHeight: 1.7, marginBottom: 16 }}>Upload your Suno track and the Demucs AI model will split it into individual stems — vocals, drums, bass, and instruments. Everything runs locally on your machine.{serverInfo.device !== "cpu" && <span style={{ color: "#a5b4fc" }}> GPU detected: {serverInfo.device_name}.</span>}</p>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {Object.entries(serverInfo.models || {}).map(([key, info]) => (
                  <button key={key} onClick={() => setSepModel(key)} style={{ border: "1px solid", borderColor: sepModel === key ? "#6366f1" : "rgba(255,255,255,0.08)", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 11, background: sepModel === key ? "rgba(99,102,241,0.15)" : "transparent", color: sepModel === key ? "#a5b4fc" : "#888", fontWeight: 600 }}>
                    {key} <span style={{ fontWeight: 400, opacity: 0.7 }}>— {info.desc}</span>
                  </button>
                ))}
              </div>
              <div style={{ textAlign: "center" }}>
                <button style={S.primaryBtn} onClick={() => document.getElementById("ai-upload").click()}><Upload size={16} /> Upload & Separate with AI</button>
                <input id="ai-upload" type="file" accept="audio/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSeparate(f); e.target.value = ""; }} />
              </div>
            </>) : serverError ? (
              <div style={{ color: "#9ca3af", fontSize: 12, lineHeight: 1.8 }}>
                <p style={{ marginBottom: 8 }}>The AI backend server isn't running. Start it with:</p>
                <code style={{ display: "block", background: "rgba(0,0,0,0.3)", padding: "8px 14px", borderRadius: 6, fontSize: 12, color: "#a5b4fc" }}>python server.py</code>
                <p style={{ marginTop: 12 }}>First time? Install dependencies:</p>
                <code style={{ display: "block", background: "rgba(0,0,0,0.3)", padding: "8px 14px", borderRadius: 6, fontSize: 12, color: "#a5b4fc" }}>pip install -r requirements.txt</code>
              </div>
            ) : (<div style={{ color: "#6b7280", fontSize: 12 }}>Checking server connection...</div>)}
          </div>
          <div style={{ border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 12, padding: "20px", textAlign: "center", cursor: "pointer", color: "#4b5563" }} onDrop={onDrop} onDragOver={e => e.preventDefault()} onClick={() => document.getElementById("manual-upload").click()}>
            <input id="manual-upload" type="file" accept="audio/*" multiple style={{ display: "none" }} onChange={onFileInput} />
            <Plus size={18} style={{ marginBottom: 4, opacity: 0.5 }} />
            <div style={{ fontSize: 12 }}>Or drop pre-separated stems here to load directly</div>
          </div>
          {recentJobs.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Headphones size={14} color="#6366f1" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Recent Results</span>
                <span style={{ fontSize: 11, color: "#6b7280" }}>— separated stems ready to load</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentJobs.map(job => {
                  const isLoading = loadingJobId === job.job_id;
                  return (
                    <div key={job.job_id} onClick={() => !loadingJobId && loadJob(job)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", cursor: loadingJobId ? "default" : "pointer", opacity: loadingJobId && !isLoading ? 0.5 : 1 }}>
                      <Cpu size={16} color="#6366f1" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#e0e0ec", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.filename}</div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{job.model} · {job.stems.length} stems · {job.stems.join(", ")}</div>
                      </div>
                      {isLoading ? <Spinner size={16} /> : <span style={{ fontSize: 11, fontWeight: 600, color: "#a5b4fc", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}><Download size={12} /> Load</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ textAlign: "center", fontSize: 10, color: "#222", marginTop: 12 }}>Space = play/pause · Click track to select · Drag on waveform to cut · No API keys — runs 100% local</div>
        </div>
      </div>
    );
  }

  if (separating) {
    return (
      <div style={S.root}>
        <div style={S.header}><div style={S.logoBox}><Scissors size={16} color="#fff" /></div><div><div style={S.title}>SunoSlicer Pro</div><div style={S.sub}>AI-Powered Stem Editor</div></div></div>
        <div style={S.body}>
          <div style={{ border: "1px solid rgba(99,102,241,0.2)", borderRadius: 14, padding: "40px 24px", background: "rgba(99,102,241,0.04)", textAlign: "center" }}>
            <Spinner size={32} />
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Separating Stems</div>
            <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>{uploadingFile}</div>
            <div style={{ display: "inline-block", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "8px 16px", fontSize: 12, color: "#a5b4fc", fontFamily: "monospace" }}>{sepStatus?.progress || "Starting..."}</div>
            <div style={{ color: "#4b5563", fontSize: 11, marginTop: 16 }}>{serverInfo?.device === "cpu" ? "Running on CPU — this usually takes 2-3 minutes per song" : "Running on GPU — should be done in about 20 seconds"}</div>
            {sepStatus?.status === "error" && (
              <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(239,68,68,0.1)", borderRadius: 8, color: "#ef4444", fontSize: 12, textAlign: "left" }}>
                <strong>Error:</strong> {sepStatus.error}
                <div style={{ marginTop: 8 }}><button style={S.btn(false)} onClick={resetAll}>← Try again</button></div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.logoBox}><Scissors size={16} color="#fff" /></div>
        <div><div style={S.title}>SunoSlicer Pro</div><div style={S.sub}>AI-Powered Stem Editor</div></div>
        <div style={{ flex: 1 }} />
        <button style={S.btn(false)} onClick={resetAll}><Upload size={12} /> New Track</button>
        <button style={S.btn(false)} onClick={() => document.getElementById("add-stems").click()}><Plus size={12} /> Add Stems</button>
        <input id="add-stems" type="file" accept="audio/*" multiple style={{ display: "none" }} onChange={onFileInput} />
      </div>
      <div style={S.body}>
        {tracks.map(track => {
          const c = TRACK_COLORS[track.color % TRACK_COLORS.length];
          const isActive = track.id === activeId;
          const eff = track.muted ? 0 : (anySoloed && !track.solo) ? 0 : track.volume;
          return (
            <div key={track.id} style={S.trackRow(isActive, c)} onClick={() => setActiveId(track.id)}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                <div style={{ width: 4, height: 20, borderRadius: 2, background: c.wave, opacity: eff > 0 ? 1 : 0.25 }} />
                <span style={{ fontWeight: 700, fontSize: 12, color: c.label, flex: 1, minWidth: 60 }}>{track.name}</span>
                <button style={S.sBtn(track.solo, "rgba(234,179,8,0.4)")} onClick={e => { e.stopPropagation(); toggleSolo(track.id); }}><Headphones size={10} /> S</button>
                <button style={S.sBtn(track.muted, "rgba(239,68,68,0.3)")} onClick={e => { e.stopPropagation(); toggleMute(track.id); }}><VolumeX size={10} /> M</button>
                <input type="range" min={0} max={1} step={0.01} value={track.volume} onChange={e => { e.stopPropagation(); setVolume(track.id, parseFloat(e.target.value)); }} onClick={e => e.stopPropagation()} style={{ width: 70, height: 4, appearance: "none", background: "rgba(255,255,255,0.1)", borderRadius: 2, outline: "none" }} />
                <span style={{ fontSize: 10, color: "#666", width: 28, textAlign: "right", fontFamily: "monospace" }}>{Math.round(track.volume * 100)}%</span>
                <button style={{ ...S.sBtn(false), color: "#555", padding: "3px 5px" }} onClick={e => { e.stopPropagation(); removeTrack(track.id); }}><X size={10} /></button>
              </div>
              <TrackWaveform track={track} duration={dur} curTime={curTime} viewStart={viewStart} viewDur={viewDur} isActive={isActive} onAddRegion={addRegion} onSeek={seek} color={c} />
              {isActive && track.regions.length > 0 && (
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {track.regions.map(r => (
                    <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", background: "rgba(239,68,68,0.1)", borderRadius: 4, fontSize: 10, color: "#ef4444", fontFamily: "monospace" }}>
                      {formatTime(r.start)}→{formatTime(r.end)}
                      <X size={9} style={{ cursor: "pointer", opacity: 0.6 }} onClick={e => { e.stopPropagation(); deleteRegion(track.id, r.id); }} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px", textAlign: "center", cursor: "pointer", color: "#333", fontSize: 11, marginTop: 4 }} onDrop={onDrop} onDragOver={e => e.preventDefault()} onClick={() => document.getElementById("add-stems").click()}><Plus size={12} style={{ verticalAlign: -2 }} /> Add more stems</div>
        {zoom > 1.05 && (<input type="range" min={0} max={1} step={0.001} value={dur - viewDur > 0 ? viewStart / (dur - viewDur) : 0} onChange={e => setViewStart(parseFloat(e.target.value) * Math.max(0, dur - viewDur))} style={{ width: "100%", height: 4, appearance: "none", background: "rgba(255,255,255,0.06)", borderRadius: 2, outline: "none", marginTop: 6 }} />)}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", flexWrap: "wrap" }}>
          <button style={S.btn(false)} onClick={restart}><SkipBack size={13} /></button>
          <button style={S.primaryBtn} onClick={togglePlay}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "Pause" : "Play"}</button>
          <span style={{ fontFamily: "monospace", fontSize: 12, color: "#a0a0b8", minWidth: 90, textAlign: "center" }}>{formatTime(curTime)} / {formatTime(dur)}</span>
          <div style={{ flex: 1 }} />
          <button style={S.btn(false)} onClick={zoomOut}><ZoomOut size={12} /></button>
          <button style={{ ...S.btn(false), fontFamily: "monospace", minWidth: 36, justifyContent: "center" }} onClick={zoomFit}>{zoom.toFixed(zoom >= 10 ? 0 : 1)}x</button>
          <button style={S.btn(false)} onClick={zoomIn}><ZoomIn size={12} /></button>
        </div>
        <div style={S.section}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={S.sectionTitle}><Download size={10} style={{ verticalAlign: -1 }} /> Export Mix</span>
            <button style={S.primaryBtn} onClick={handleExport} disabled={exporting}><Download size={13} />{exporting ? "Mixing..." : "Export WAV"}</button>
          </div>
          <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>Exports all unmuted stems mixed with volumes and cut regions applied. Stereo 16-bit WAV.{anySoloed && <span style={{ color: "#eab308" }}> Solo active — only soloed tracks exported.</span>}</div>
        </div>
        {activeTrack && (<div style={{ marginTop: 8, fontSize: 11, color: "#333", textAlign: "center" }}>Editing: <strong style={{ color: TRACK_COLORS[activeTrack.color % TRACK_COLORS.length].label }}>{activeTrack.name}</strong> — drag on waveform to mark sections for removal</div>)}
      </div>
    </div>
  );
}
