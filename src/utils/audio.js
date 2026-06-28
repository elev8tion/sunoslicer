/* ── Time Formatting ───────────────────────────────────────── */

export function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

/* ── WAV Encoding ──────────────────────────────────────────── */

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWAV(channelData, sampleRate, numChannels) {
  const numSamples = channelData[0].length;
  const bitsPerSample = 16;
  const dataLength = numSamples * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(view, 8, "WAVE");

  // fmt chunk
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeStr(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/* ── Region Processing ─────────────────────────────────────── */

function applyRegionsToChannel(data, regions, sampleRate) {
  const out = new Float32Array(data.length);
  out.set(data);

  for (const r of regions) {
    const rs = Math.floor(r.start * sampleRate);
    const re = Math.min(Math.floor(r.end * sampleRate), out.length);
    const fadeLen = Math.min(Math.floor(sampleRate * 0.003), Math.floor((re - rs) / 2));

    for (let i = rs; i < re; i++) {
      if (i < rs + fadeLen) {
        out[i] *= 1 - (i - rs) / fadeLen;
      } else if (i >= re - fadeLen) {
        out[i] *= (re - i) / fadeLen;
      } else {
        out[i] = 0;
      }
    }
  }

  return out;
}

/* ── Mix & Export ───────────────────────────────────────────── */

export function mixAndExport(tracks, masterDuration, sampleRate) {
  const numChannels = 2;
  const totalSamples = Math.ceil(masterDuration * sampleRate);
  const mixed = Array.from({ length: numChannels }, () => new Float32Array(totalSamples));
  const anySoloed = tracks.some((t) => t.solo);

  for (const track of tracks) {
    if (track.muted) continue;
    if (anySoloed && !track.solo) continue;
    if (!track.audioBuffer) continue;

    const buf = track.audioBuffer;
    const vol = track.volume;
    const trackChannels = buf.numberOfChannels;

    // Get channel data with regions applied
    const processedChannels = [];
    for (let c = 0; c < trackChannels; c++) {
      const raw = buf.getChannelData(c);
      const processed =
        track.regions && track.regions.length > 0
          ? applyRegionsToChannel(raw, track.regions, sampleRate)
          : raw;
      processedChannels.push(processed);
    }

    // Mix into output (upmix mono to stereo if needed)
    for (let c = 0; c < numChannels; c++) {
      const srcCh = processedChannels[Math.min(c, trackChannels - 1)];
      const len = Math.min(srcCh.length, totalSamples);
      for (let i = 0; i < len; i++) {
        mixed[c][i] += srcCh[i] * vol;
      }
    }
  }

  // Normalize if clipping
  let peak = 0;
  for (let c = 0; c < numChannels; c++) {
    for (let i = 0; i < totalSamples; i++) {
      const abs = Math.abs(mixed[c][i]);
      if (abs > peak) peak = abs;
    }
  }
  if (peak > 1) {
    const scale = 0.98 / peak;
    for (let c = 0; c < numChannels; c++) {
      for (let i = 0; i < totalSamples; i++) {
        mixed[c][i] *= scale;
      }
    }
  }

  return encodeWAV(mixed, sampleRate, numChannels);
}

/* ── Single Track Export ───────────────────────────────────── */

export function exportSingleTrack(audioBuffer, regions, mode) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let outChannels;

  if (mode === "cut") {
    // Remove regions and stitch
    const sorted = [...regions].sort((a, b) => a.start - b.start);
    const keeps = [];
    let cursor = 0;
    for (const r of sorted) {
      const rs = Math.floor(r.start * sampleRate);
      const re = Math.floor(r.end * sampleRate);
      if (rs > cursor) keeps.push([cursor, rs]);
      cursor = Math.max(cursor, re);
    }
    if (cursor < channels[0].length) keeps.push([cursor, channels[0].length]);

    const totalSamples = keeps.reduce((sum, [a, b]) => sum + (b - a), 0);
    outChannels = channels.map(() => new Float32Array(totalSamples));
    let writeOffset = 0;
    for (const [s, e] of keeps) {
      for (let ch = 0; ch < numChannels; ch++) {
        outChannels[ch].set(channels[ch].subarray(s, e), writeOffset);
      }
      writeOffset += e - s;
    }
  } else {
    // Mute / silence regions
    outChannels = channels.map((ch) => applyRegionsToChannel(ch, regions, sampleRate));
  }

  return encodeWAV(outChannels, sampleRate, numChannels);
}
