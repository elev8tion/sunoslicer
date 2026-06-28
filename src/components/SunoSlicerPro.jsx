import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Upload, Play, Pause, Trash2, Download,
  ZoomIn, ZoomOut, SkipBack, Scissors,
  VolumeX, X, Plus, Headphones,
} from "lucide-react";
import TrackWaveform from "./TrackWaveform";
import { formatTime, mixAndExport } from "../utils/audio";
import { TRACK_COLORS, guessStemName } from "../utils/constants";

export default function SunoSlicerPro() {
  const [tracks, setTracks] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const ctxRef = useRef(null);
  const sourcesRef = useRef([]);
  const gainsRef = useRef([]);
  const rafRef = useRef(null);
  const playCtxStart = useRef(0);
  const playOffset = useRef(0);
  const nextId = useRef(0);
  const nextRid = useRef(0);

  const dur = useMemo(
    () => Math.max(0, ...tracks.map((t) => t.audioBuffer?.duration || 0)),
    [tracks]
  );
  const sampleRate = useMemo(
    () => tracks[0]?.audioBuffer?.sampleRate || 44100,
    [tracks]
  );
  const viewDur = dur / zoom || 1;
  const anySoloed = tracks.some((t) => t.solo);

  const getCtx = useCallback(() => {
    if (!ctxRef.current)
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (ctxRef.current.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  /* ── File loading ──────────────────────────────────────── */

  const addFiles = useCallback(
    async (files) => {
      setLoading(true);
      const ac = getCtx();
      const newTracks = [];

      for (const file of files) {
        try {
          const ab = await file.arrayBuffer();
          const decoded = await ac.decodeAudioData(ab);
          const id = ++nextId.current;
          const colorIdx =
            (tracks.length + newTracks.length) % TRACK_COLORS.length;
          newTracks.push({
            id,
            name: guessStemName(file.name),
            fileName: file.name,
            audioBuffer: decoded,
            volume: 1,
            muted: false,
            solo: false,
            regions: [],
            color: colorIdx,
          });
        } catch (e) {
          console.error("Failed to decode:", file.name, e);
        }
      }

      setTracks((prev) => [...prev, ...newTracks]);
      if (!activeId && newTracks.length > 0) setActiveId(newTracks[0].id);
      setLoading(false);
    },
    [getCtx, tracks.length, activeId]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])].filter(
        (f) =>
          f.type.startsWith("audio/") ||
          f.name.match(/\.(mp3|wav|m4a|ogg|flac|webm|aac)$/i)
      );
      if (files.length) addFiles(files);
    },
    [addFiles]
  );

  const onFileInput = useCallback(
    (e) => {
      const files = [...(e.target.files || [])];
      if (files.length) addFiles(files);
      e.target.value = "";
    },
    [addFiles]
  );

  /* ── Track controls ────────────────────────────────────── */

  const removeTrack = useCallback(
    (id) => {
      setTracks((prev) => prev.filter((t) => t.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [activeId]
  );

  const toggleMute = useCallback((id) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t))
    );
  }, []);

  const toggleSolo = useCallback((id) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, solo: !t.solo } : t))
    );
  }, []);

  const setVolume = useCallback((id, vol) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, volume: vol } : t))
    );
  }, []);

  const addRegion = useCallback((trackId, start, end) => {
    const rid = ++nextRid.current;
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? { ...t, regions: [...t.regions, { id: rid, start, end }] }
          : t
      )
    );
  }, []);

  const deleteRegion = useCallback((trackId, regionId) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId
          ? { ...t, regions: t.regions.filter((r) => r.id !== regionId) }
          : t
      )
    );
  }, []);

  /* ── Playback ──────────────────────────────────────────── */

  const stopPlayback = useCallback(() => {
    for (const s of sourcesRef.current) {
      try { s.stop(); } catch {}
    }
    sourcesRef.current = [];
    gainsRef.current = [];
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(
    (fromTime) => {
      if (tracks.length === 0) return;
      stopPlayback();
      const ac = getCtx();
      const sources = [];
      const gains = [];

      for (const track of tracks) {
        if (!track.audioBuffer) continue;
        const src = ac.createBufferSource();
        src.buffer = track.audioBuffer;
        const gain = ac.createGain();

        const effective = track.muted
          ? 0
          : anySoloed && !track.solo
          ? 0
          : track.volume;
        gain.gain.setValueAtTime(effective, ac.currentTime);

        // Schedule region mutes
        if (track.regions.length > 0 && effective > 0) {
          const sorted = [...track.regions].sort((a, b) => a.start - b.start);
          for (const r of sorted) {
            if (r.end <= fromTime) continue;
            const rStart = Math.max(r.start, fromTime);
            const now = ac.currentTime;
            const tOff = rStart - fromTime;
            gain.gain.setValueAtTime(effective, now + tOff - 0.003);
            gain.gain.linearRampToValueAtTime(0, now + tOff);
            gain.gain.setValueAtTime(0, now + (r.end - fromTime) - 0.003);
            gain.gain.linearRampToValueAtTime(
              effective,
              now + (r.end - fromTime)
            );
          }
        }

        src.connect(gain).connect(ac.destination);
        src.start(0, fromTime);
        sources.push(src);
        gains.push(gain);
      }

      sourcesRef.current = sources;
      gainsRef.current = gains;
      playCtxStart.current = ac.currentTime;
      playOffset.current = fromTime;
      setPlaying(true);

      if (sources.length > 0) {
        sources[0].onended = () => {
          setPlaying(false);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
      }

      const tick = () => {
        const elapsed = ac.currentTime - playCtxStart.current;
        const ct = playOffset.current + elapsed;
        if (ct >= dur) {
          setCurTime(dur);
          setPlaying(false);
          return;
        }
        setCurTime(ct);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [tracks, dur, getCtx, stopPlayback, anySoloed]
  );

  const togglePlay = useCallback(() => {
    if (playing) stopPlayback();
    else startPlayback(curTime >= dur - 0.05 ? 0 : curTime);
  }, [playing, curTime, dur, startPlayback, stopPlayback]);

  const seek = useCallback(
    (t) => {
      setCurTime(t);
      if (playing) startPlayback(t);
    },
    [playing, startPlayback]
  );

  const restart = useCallback(() => {
    stopPlayback();
    setCurTime(0);
  }, [stopPlayback]);

  /* ── Zoom ──────────────────────────────────────────────── */

  const zoomIn = () => {
    const nz = Math.min(zoom * 1.5, 200);
    const center = viewStart + viewDur / 2;
    const nvd = dur / nz;
    setZoom(nz);
    setViewStart(Math.max(0, Math.min(dur - nvd, center - nvd / 2)));
  };

  const zoomOut = () => {
    const nz = Math.max(zoom / 1.5, 1);
    const nvd = dur / nz;
    const center = viewStart + viewDur / 2;
    setZoom(nz);
    setViewStart(nz <= 1 ? 0 : Math.max(0, Math.min(dur - nvd, center - nvd / 2)));
  };

  const zoomFit = () => {
    setZoom(1);
    setViewStart(0);
  };

  const onScrollBar = (e) => {
    setViewStart(parseFloat(e.target.value) * Math.max(0, dur - viewDur));
  };

  /* ── Export ────────────────────────────────────────────── */

  const handleExport = useCallback(() => {
    if (tracks.length === 0) return;
    setExporting(true);
    setTimeout(() => {
      try {
        const blob = mixAndExport(tracks, dur, sampleRate);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "suno_mix_edited.wav";
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert("Export failed: " + e.message);
      }
      setExporting(false);
    }, 50);
  }, [tracks, dur, sampleRate]);

  /* ── Keyboard shortcuts ────────────────────────────────── */

  useEffect(() => {
    const onKey = (e) => {
      if (tracks.length === 0) return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.code === "Home") { e.preventDefault(); restart(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tracks, togglePlay, restart]);

  const activeTrack = tracks.find((t) => t.id === activeId);

  /* ── Inline Styles ─────────────────────────────────────── */

  const S = {
    root: {
      background: "#08080f", color: "#e0e0ec", minHeight: "100vh",
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif", fontSize: 13,
    },
    header: { padding: "16px 20px 8px", display: "flex", alignItems: "center", gap: 10 },
    logoBox: {
      width: 30, height: 30, borderRadius: 7,
      background: "linear-gradient(135deg, #6366f1, #22d3ee)",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
    title: { fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" },
    sub: { fontSize: 10, color: "#6b7280", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" },
    body: { padding: "0 16px 16px" },
    upload: {
      border: "2px dashed rgba(99,102,241,0.3)", borderRadius: 14,
      padding: "52px 24px", textAlign: "center", cursor: "pointer",
      background: "rgba(99,102,241,0.03)",
    },
    addBtn: {
      border: "1px dashed rgba(255,255,255,0.15)", borderRadius: 8,
      padding: "10px", textAlign: "center", cursor: "pointer",
      color: "#6b7280", fontSize: 12, display: "flex",
      alignItems: "center", justifyContent: "center", gap: 6, marginTop: 6,
    },
    trackRow: (active, c) => ({
      background: active ? c.bg : "rgba(255,255,255,0.015)",
      border: `1px solid ${active ? c.border : "rgba(255,255,255,0.04)"}`,
      borderRadius: 10, padding: "8px 10px", marginBottom: 6,
      transition: "all 0.15s", cursor: "pointer",
    }),
    trackHeader: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" },
    trackName: (c) => ({ fontWeight: 700, fontSize: 12, color: c.label, flex: 1, minWidth: 60 }),
    sBtn: (active, bg) => ({
      border: "none", borderRadius: 4, padding: "3px 8px",
      fontSize: 10, fontWeight: 700, cursor: "pointer",
      background: active ? (bg || "rgba(99,102,241,0.3)") : "rgba(255,255,255,0.06)",
      color: active ? "#fff" : "#888", transition: "all 0.12s",
      letterSpacing: "0.03em", display: "inline-flex", alignItems: "center", gap: 3,
    }),
    vol: {
      width: 70, height: 4, appearance: "none",
      background: "rgba(255,255,255,0.1)", borderRadius: 2,
      outline: "none", cursor: "pointer", verticalAlign: "middle",
    },
    transport: { display: "flex", alignItems: "center", gap: 6, padding: "8px 0", flexWrap: "wrap" },
    playBtn: {
      border: "none", borderRadius: 8, padding: "7px 16px",
      cursor: "pointer", display: "inline-flex", alignItems: "center",
      gap: 5, fontSize: 12, fontWeight: 600, background: "#6366f1", color: "#fff",
    },
    btn: (active) => ({
      border: "none", borderRadius: 6, padding: "5px 10px",
      cursor: "pointer", display: "inline-flex", alignItems: "center",
      gap: 4, fontSize: 11, fontWeight: 600,
      background: active ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)",
      color: active ? "#a5b4fc" : "#999", transition: "all 0.12s",
    }),
    time: { fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#a0a0b8", minWidth: 90, textAlign: "center" },
    section: {
      marginTop: 10, padding: "10px 12px",
      background: "rgba(255,255,255,0.02)", borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.04)",
    },
    sectionTitle: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#666", marginBottom: 6 },
  };

  /* ── Empty State ───────────────────────────────────────── */

  if (tracks.length === 0) {
    return (
      <div style={S.root}>
        <div style={S.header}>
          <div style={S.logoBox}><Scissors size={14} color="#fff" /></div>
          <div>
            <div style={S.title}>SunoSlicer Pro</div>
            <div style={S.sub}>Multi-Track Stem Editor</div>
          </div>
        </div>
        <div style={S.body}>
          <div
            style={S.upload}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => document.getElementById("fi0").click()}
          >
            <input
              id="fi0" type="file" accept="audio/*" multiple
              style={{ display: "none" }}
              onChange={onFileInput}
            />
            {loading ? (
              <div style={{ color: "#a5b4fc" }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                  Decoding audio...
                </div>
              </div>
            ) : (
              <>
                <Upload size={36} color="#6366f1" style={{ marginBottom: 12 }} />
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                  Drop your stems or full track here
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>
                  Select multiple files at once to load all stems
                </div>
                <div
                  style={{
                    fontSize: 11, color: "#4b5563", maxWidth: 460,
                    margin: "0 auto", lineHeight: 1.7,
                  }}
                >
                  <strong style={{ color: "#888" }}>Workflow:</strong> Run{" "}
                  <code
                    style={{
                      background: "rgba(99,102,241,0.15)",
                      padding: "1px 5px", borderRadius: 3, fontSize: 11,
                    }}
                  >
                    python separate.py song.mp3
                  </code>{" "}
                  to split your Suno track into stems, then drop the resulting
                  WAV files here. Adjust volumes, mute or solo individual
                  layers, cut unwanted vocal sections, and export your custom
                  mix.
                </div>
              </>
            )}
          </div>
          <div style={{ textAlign: "center", fontSize: 10, color: "#2a2a3a", marginTop: 12 }}>
            Space = play/pause · Click a track to select for editing · Drag on
            active waveform to mark cut regions
          </div>
        </div>
      </div>
    );
  }

  /* ── Editor ────────────────────────────────────────────── */

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoBox}><Scissors size={14} color="#fff" /></div>
        <div>
          <div style={S.title}>SunoSlicer Pro</div>
          <div style={S.sub}>Multi-Track Stem Editor</div>
        </div>
        <div style={{ flex: 1 }} />
        <label
          style={S.btn(false)}
          onClick={() => document.getElementById("fi1").click()}
        >
          <Plus size={12} /> Add Stems
        </label>
        <input
          id="fi1" type="file" accept="audio/*" multiple
          style={{ display: "none" }}
          onChange={onFileInput}
        />
      </div>

      <div style={S.body}>
        {/* ── Track List ──────────────────────────────────── */}
        {tracks.map((track) => {
          const c = TRACK_COLORS[track.color % TRACK_COLORS.length];
          const isActive = track.id === activeId;
          const effectiveVol = track.muted
            ? 0
            : anySoloed && !track.solo
            ? 0
            : track.volume;

          return (
            <div
              key={track.id}
              style={S.trackRow(isActive, c)}
              onClick={() => setActiveId(track.id)}
            >
              {/* Track controls row */}
              <div style={S.trackHeader}>
                <div
                  style={{
                    width: 4, height: 20, borderRadius: 2,
                    background: c.wave, flexShrink: 0,
                    opacity: effectiveVol > 0 ? 1 : 0.25,
                  }}
                />
                <span style={S.trackName(c)}>{track.name}</span>

                <button
                  style={S.sBtn(track.solo, "rgba(234,179,8,0.4)")}
                  onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
                  title="Solo"
                >
                  <Headphones size={10} /> S
                </button>
                <button
                  style={S.sBtn(track.muted, "rgba(239,68,68,0.3)")}
                  onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
                  title="Mute"
                >
                  <VolumeX size={10} /> M
                </button>

                <input
                  type="range" min={0} max={1} step={0.01}
                  value={track.volume}
                  onChange={(e) => {
                    e.stopPropagation();
                    setVolume(track.id, parseFloat(e.target.value));
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={S.vol}
                  title={`Volume: ${Math.round(track.volume * 100)}%`}
                />
                <span
                  style={{
                    fontSize: 10, color: "#666", width: 28,
                    textAlign: "right", fontFamily: "monospace",
                  }}
                >
                  {Math.round(track.volume * 100)}%
                </span>

                <button
                  style={{ ...S.sBtn(false), color: "#555", padding: "3px 5px" }}
                  onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                  title="Remove track"
                >
                  <X size={10} />
                </button>
              </div>

              {/* Waveform */}
              <TrackWaveform
                track={track}
                duration={dur}
                curTime={curTime}
                viewStart={viewStart}
                viewDur={viewDur}
                isActive={isActive}
                onAddRegion={addRegion}
                onSeek={seek}
                color={c}
              />

              {/* Region pills for active track */}
              {isActive && track.regions.length > 0 && (
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {track.regions.map((r) => (
                    <span
                      key={r.id}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 6px", background: "rgba(239,68,68,0.1)",
                        borderRadius: 4, fontSize: 10, color: "#ef4444",
                        fontFamily: "monospace",
                      }}
                    >
                      {formatTime(r.start)}→{formatTime(r.end)}
                      <X
                        size={9}
                        style={{ cursor: "pointer", opacity: 0.6 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRegion(track.id, r.id);
                        }}
                      />
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Add more stems */}
        <div
          style={S.addBtn}
          onClick={() => document.getElementById("fi1").click()}
        >
          <Plus size={13} /> Drop or click to add more stems
        </div>

        {/* Scroll bar when zoomed */}
        {zoom > 1.05 && (
          <input
            type="range" min={0} max={1} step={0.001}
            value={dur - viewDur > 0 ? viewStart / (dur - viewDur) : 0}
            onChange={onScrollBar}
            style={{
              width: "100%", height: 4, appearance: "none",
              background: "rgba(255,255,255,0.06)", borderRadius: 2,
              outline: "none", cursor: "pointer", marginTop: 6,
            }}
          />
        )}

        {/* ── Transport ───────────────────────────────────── */}
        <div style={S.transport}>
          <button style={S.btn(false)} onClick={restart}>
            <SkipBack size={13} />
          </button>
          <button style={S.playBtn} onClick={togglePlay}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? "Pause" : "Play"}
          </button>
          <span style={S.time}>
            {formatTime(curTime)} / {formatTime(dur)}
          </span>
          <div style={{ flex: 1 }} />
          <button style={S.btn(false)} onClick={zoomOut}><ZoomOut size={12} /></button>
          <button
            style={{
              ...S.btn(false),
              fontFamily: "monospace", minWidth: 36, justifyContent: "center",
            }}
            onClick={zoomFit}
          >
            {zoom.toFixed(zoom >= 10 ? 0 : 1)}x
          </button>
          <button style={S.btn(false)} onClick={zoomIn}><ZoomIn size={12} /></button>
        </div>

        {/* ── Export ───────────────────────────────────────── */}
        <div style={S.section}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={S.sectionTitle}>
              <Download size={10} style={{ verticalAlign: -1 }} /> Export Mix
            </span>
            <button
              style={S.playBtn}
              onClick={handleExport}
              disabled={exporting}
            >
              <Download size={13} />
              {exporting ? "Mixing..." : "Export WAV"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>
            Exports all unmuted stems mixed with volume levels and cut regions
            applied. Stereo 16-bit WAV at {sampleRate}Hz.
            {anySoloed && (
              <span style={{ color: "#eab308" }}>
                {" "}Solo active — only soloed tracks will be included.
              </span>
            )}
          </div>
        </div>

        {/* Active track hint */}
        {activeTrack && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#333", textAlign: "center" }}>
            Editing:{" "}
            <strong
              style={{
                color: TRACK_COLORS[activeTrack.color % TRACK_COLORS.length].label,
              }}
            >
              {activeTrack.name}
            </strong>{" "}
            — drag on its waveform to mark sections for removal
          </div>
        )}
      </div>
    </div>
  );
}
