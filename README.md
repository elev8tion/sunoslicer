# SunoSlicer Pro

Multi-track stem editor for Suno AI music. Separate your Suno songs into individual stems (vocals, drums, bass, instruments), then mix, edit, and export with full control over every layer.

![License](https://img.shields.io/badge/license-MIT-blue)

## What It Does

1. **Separate** — Split any Suno track into isolated stems using Meta's Demucs AI model (runs locally, no API key needed)
2. **Mix** — Load stems into the browser-based editor with per-track volume, mute, and solo controls
3. **Edit** — Select and remove specific vocal sections, ad-libs, or harmonies with click-and-drag region editing
4. **Export** — Download your custom mix as a high-quality stereo WAV file

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (for the editor UI)
- [Python](https://python.org/) 3.9+ (for stem separation)

### 1. Clone & Install

```bash
git clone https://github.com/elev8tion/sunoslicer.git
cd sunoslicer

# Install the web editor
npm install

# Install stem separation (one-time)
pip install -r requirements.txt
```

### 2. Separate Your Track

```bash
python separate.py your-suno-song.mp3
```

This creates a `separated/htdemucs_ft/your-suno-song/` folder with individual WAV stems:
- `vocals.wav` — All vocal layers
- `drums.wav` — Percussion
- `bass.wav` — Bass line
- `other.wav` — Synths, pads, effects

For more stems (adds guitar + piano):
```bash
python separate.py your-suno-song.mp3 --model htdemucs_6s
```

### 3. Launch the Editor

```bash
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000). Drop your separated WAV stems into the editor.

## Editor Features

### Track Controls
- **Solo (S)** — Isolate a single stem to hear it alone
- **Mute (M)** — Silence a stem in the mix
- **Volume** — Per-track volume fader (0–100%)
- **Remove** — Remove a track from the session

### Region Editing
1. Click a track to make it **active** (highlighted border)
2. Click and drag on the waveform to select a region
3. Selected regions appear in red — these sections will be silenced
4. Region pills below the track show timestamps; click ✕ to remove

### Navigation
- **Scroll wheel** on waveform to zoom in/out
- **Click** on waveform to seek
- **Zoom buttons** in the transport bar
- **Scroll bar** appears when zoomed in

### Export
Exports all unmuted stems mixed together with:
- Volume levels applied
- Cut regions silenced (with smooth 3ms fades)
- Stereo 16-bit WAV at the original sample rate
- Auto-normalization if the mix clips

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Space | Play / Pause |
| Home | Restart |

## Separation Options

| Model | Stems | Speed | Quality | Best For |
|-------|-------|-------|---------|----------|
| `htdemucs_ft` (default) | 4 | Medium | Best | Clean vocal isolation |
| `htdemucs` | 4 | Fast | Good | Quick separations |
| `htdemucs_6s` | 6 | Slower | Good | Guitar/piano separation |

### GPU Acceleration

Separation runs on CPU by default (~2-3 min per song). For NVIDIA GPU acceleration (~15-20 sec):

```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

### Batch Processing

```bash
python separate.py *.mp3
python separate.py track1.mp3 track2.wav track3.m4a
```

## Project Structure

```
sunoslicer/
├── index.html              # App entry point
├── package.json            # Node dependencies
├── vite.config.js          # Vite configuration
├── separate.py             # Demucs stem separation script
├── requirements.txt        # Python dependencies
└── src/
    ├── main.jsx            # React entry
    ├── App.jsx             # Root component
    ├── components/
    │   ├── SunoSlicerPro.jsx   # Main editor component
    │   └── TrackWaveform.jsx   # Waveform canvas renderer
    └── utils/
        ├── audio.js        # WAV encoding, mixing, export
        └── constants.js    # Colors, stem name mapping
```

## How It Works

### Stem Separation
Uses [Demucs](https://github.com/facebookresearch/demucs) by Meta Research — a hybrid transformer/waveform model trained on thousands of songs. Everything runs locally on your machine; no audio is uploaded anywhere.

### Browser Audio
The editor uses the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) for decoding, playback, and real-time gain scheduling. Waveforms are rendered on HTML Canvas. Export uses direct PCM sample manipulation for lossless quality.

### Why This Works Well for Suno
Suno's AI-generated tracks tend to have cleaner separation between elements than live recordings. The synthetic nature of the audio means Demucs can isolate stems with higher fidelity than it typically achieves on recorded music.

## Typical Workflow

1. Generate your track on [Suno](https://suno.ai)
2. Download the MP3
3. Run `python separate.py song.mp3` to get stems
4. Open the editor with `npm run dev`
5. Drop all stems into the editor
6. Solo the vocals to identify parts you want to cut
7. Click the vocals track to activate it
8. Drag across the unwanted vocal sections
9. Un-solo to hear the full mix with cuts applied
10. Adjust stem volumes to taste
11. Export your final WAV

## License

MIT

---

Built with Elev8tion 🎵
