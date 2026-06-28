import { useRef, useEffect, useState, useCallback } from "react";

export default function TrackWaveform({
  track,
  duration,
  curTime,
  viewStart,
  viewDur,
  isActive,
  onAddRegion,
  onSeek,
  color,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dragS, setDragS] = useState(null);
  const [dragE, setDragE] = useState(null);

  const H = isActive ? 100 : 56;
  const viewEnd = Math.min(viewStart + viewDur, duration);

  const timeToX = useCallback(
    (t, w) => ((t - viewStart) / viewDur) * w,
    [viewStart, viewDur]
  );

  const xToTime = useCallback(
    (x, w) => viewStart + (x / w) * viewDur,
    [viewStart, viewDur]
  );

  const getMouseTime = useCallback(
    (e) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return Math.max(
        0,
        Math.min(duration, xToTime(e.clientX - rect.left, rect.width))
      );
    },
    [xToTime, duration]
  );

  /* ── Drawing ─────────────────────────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !track.audioBuffer) return;

    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = H;

    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d");
    const buf = track.audioBuffer;
    const sr = buf.sampleRate;
    const nCh = buf.numberOfChannels;

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, w, h);

    // Compute peaks for visible range
    const startSamp = Math.floor(viewStart * sr);
    const endSamp = Math.min(Math.floor(viewEnd * sr), buf.length);
    const range = endSamp - startSamp;
    if (range <= 0) return;

    const numPeaks = Math.min(w, range);
    const sampPerPeak = range / numPeaks;
    const channels = [];
    for (let i = 0; i < nCh; i++) channels.push(buf.getChannelData(i));

    const mid = h / 2;

    // Waveform fill
    ctx.fillStyle = color.wave;
    ctx.globalAlpha = track.muted ? 0.2 : 0.7;
    ctx.beginPath();

    // Upper half
    for (let p = 0; p < numPeaks; p++) {
      const s = startSamp + Math.floor(p * sampPerPeak);
      const e = startSamp + Math.floor((p + 1) * sampPerPeak);
      let mx = 0;
      for (let j = s; j < e && j < buf.length; j++) {
        let avg = 0;
        for (let ch = 0; ch < nCh; ch++) avg += channels[ch][j];
        avg /= nCh;
        if (avg > mx) mx = avg;
      }
      const x = (p / numPeaks) * w;
      if (p === 0) ctx.moveTo(x, mid - mx * mid);
      else ctx.lineTo(x, mid - mx * mid);
    }

    // Lower half (reverse)
    for (let p = numPeaks - 1; p >= 0; p--) {
      const s = startSamp + Math.floor(p * sampPerPeak);
      const e = startSamp + Math.floor((p + 1) * sampPerPeak);
      let mn = 0;
      for (let j = s; j < e && j < buf.length; j++) {
        let avg = 0;
        for (let ch = 0; ch < nCh; ch++) avg += channels[ch][j];
        avg /= nCh;
        if (avg < mn) mn = avg;
      }
      const x = (p / numPeaks) * w;
      ctx.lineTo(x, mid - mn * mid);
    }

    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Cut regions
    if (track.regions) {
      for (const r of track.regions) {
        const x1 = timeToX(r.start, w);
        const x2 = timeToX(r.end, w);
        if (x2 < 0 || x1 > w) continue;
        const rx = Math.max(0, x1);
        const rw = Math.min(w, x2) - rx;
        ctx.fillStyle = "rgba(239,68,68,0.25)";
        ctx.fillRect(rx, 0, rw, h);
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, 0, rw, h);
      }
    }

    // Active drag selection
    if (dragging && dragS != null && dragE != null) {
      const x1 = timeToX(Math.min(dragS, dragE), w);
      const x2 = timeToX(Math.max(dragS, dragE), w);
      ctx.fillStyle = "rgba(99,102,241,0.3)";
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.strokeStyle = "#818cf8";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x1, 0, x2 - x1, h);
      ctx.setLineDash([]);
    }

    // Playback cursor
    const cx = timeToX(curTime, w);
    if (cx >= 0 && cx <= w) {
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
    }
  }, [track, curTime, viewStart, viewDur, viewEnd, H, dragging, dragS, dragE, color, timeToX]);

  /* ── Resize observer ─────────────────────────────────────── */

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      /* triggers re-render via dependency change */
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /* ── Mouse handlers ──────────────────────────────────────── */

  const handleMouseDown = (e) => {
    if (!isActive || e.button !== 0) return;
    const t = getMouseTime(e);
    setDragging(true);
    setDragS(t);
    setDragE(t);
  };

  const handleMouseMove = (e) => {
    if (dragging) setDragE(getMouseTime(e));
  };

  const handleMouseUp = () => {
    if (dragging && dragS != null && dragE != null) {
      const s = Math.min(dragS, dragE);
      const en = Math.max(dragS, dragE);
      if (en - s > 0.03) onAddRegion(track.id, s, en);
    }
    setDragging(false);
    setDragS(null);
    setDragE(null);
  };

  const handleClick = (e) => {
    if (!dragging) onSeek(getMouseTime(e));
  };

  return (
    <div
      ref={wrapRef}
      style={{
        borderRadius: 6,
        overflow: "hidden",
        cursor: isActive ? "crosshair" : "pointer",
        border: `1px solid ${isActive ? color.border : "rgba(255,255,255,0.04)"}`,
      }}
    >
      <canvas
        ref={canvasRef}
        height={H}
        style={{ display: "block", width: "100%", height: H }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          if (dragging) handleMouseUp();
        }}
        onClick={handleClick}
      />
    </div>
  );
}
