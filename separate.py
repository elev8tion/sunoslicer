#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════╗
║  SunoSlicer Stem Separator                           ║
║  Splits Suno tracks into vocal, drum, bass & other   ║
║  stems using Meta's Demucs AI model.                 ║
╚══════════════════════════════════════════════════════╝

FIRST-TIME SETUP:
─────────────────
  pip install demucs torch torchaudio

  (If you have an NVIDIA GPU for faster processing):
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

USAGE:
──────
  python separate.py my_suno_song.mp3
  python separate.py my_suno_song.mp3 --model htdemucs_6s
  python separate.py my_suno_song.mp3 --output ./my_stems
  python separate.py *.mp3

MODELS:
───────
  htdemucs_ft   (default) Best vocal isolation, 4 stems — recommended
  htdemucs      Faster, slightly less precise, 4 stems
  htdemucs_6s   6 stems (adds guitar + piano separation)

OUTPUT:
───────
  Creates a folder per song with WAV stems:
    separated/
      my_suno_song/
        vocals.wav      ← lead + backing vocals
        drums.wav       ← percussion
        bass.wav        ← bass line
        other.wav       ← synths, pads, effects
        (guitar.wav)    ← only with htdemucs_6s
        (piano.wav)     ← only with htdemucs_6s

  Load these stems into SunoSlicer Pro to mix, mute,
  and edit individual layers before exporting.
"""

import sys
import os
import time
import argparse
import subprocess
from pathlib import Path


MODELS = {
    "htdemucs_ft": "Best quality, 4 stems (vocals/drums/bass/other)",
    "htdemucs": "Fast, good quality, 4 stems",
    "htdemucs_6s": "6 stems (adds guitar + piano)",
}


def check_dependencies():
    """Verify demucs and torch are installed."""
    missing = []
    try:
        import torch
    except ImportError:
        missing.append("torch")
    try:
        import demucs
    except ImportError:
        missing.append("demucs")

    if missing:
        print("\n❌  Missing dependencies:", ", ".join(missing))
        print("\n   Install with:")
        print("   pip install demucs torch torchaudio")
        print("\n   For NVIDIA GPU acceleration:")
        print("   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121")
        sys.exit(1)


def get_device_info():
    """Report available compute device."""
    import torch
    if torch.cuda.is_available():
        name = torch.cuda.get_device_name(0)
        return f"🟢 GPU: {name}"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "🟢 Apple Silicon (MPS)"
    else:
        return "🟡 CPU (no GPU detected — separation will be slower)"


def separate(input_files, model="htdemucs_ft", output_dir=None):
    """Run Demucs separation on input files."""
    check_dependencies()

    if output_dir is None:
        output_dir = Path("separated")
    else:
        output_dir = Path(output_dir)

    print(f"\n{'═' * 54}")
    print(f"  SunoSlicer Stem Separator")
    print(f"{'═' * 54}")
    print(f"  Model:   {model} — {MODELS.get(model, 'custom')}")
    print(f"  Device:  {get_device_info()}")
    print(f"  Output:  {output_dir.resolve()}")
    print(f"  Files:   {len(input_files)}")
    print(f"{'═' * 54}\n")

    for i, filepath in enumerate(input_files, 1):
        filepath = Path(filepath)
        if not filepath.exists():
            print(f"  ⚠️  File not found: {filepath}")
            continue

        if not filepath.suffix.lower() in ('.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.webm'):
            print(f"  ⚠️  Unsupported format: {filepath}")
            continue

        print(f"  [{i}/{len(input_files)}] Separating: {filepath.name}")
        start = time.time()

        try:
            cmd = [
                sys.executable, "-m", "demucs",
                "--name", model,
                "--out", str(output_dir),
                "--wav",       # Output as WAV for maximum quality
                "--two-stems", "vocals",  # Remove this line if you want all stems
                str(filepath),
            ]

            # Remove the --two-stems flag to get all stems
            # For full separation (all stems), use this instead:
            cmd = [
                sys.executable, "-m", "demucs",
                "--name", model,
                "--out", str(output_dir),
                str(filepath),
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
            )

            elapsed = time.time() - start

            if result.returncode == 0:
                stem_dir = output_dir / model / filepath.stem
                stems = list(stem_dir.glob("*.wav"))
                stem_names = [s.stem for s in stems]
                print(f"      ✅  Done in {elapsed:.1f}s → {len(stems)} stems: {', '.join(stem_names)}")
                print(f"      📂  {stem_dir}")
            else:
                print(f"      ❌  Failed: {result.stderr[:200]}")

        except Exception as e:
            print(f"      ❌  Error: {e}")

    print(f"\n{'─' * 54}")
    print(f"  Done! Load the WAV stems into SunoSlicer Pro")
    print(f"  to mix, edit, and export your final track.")
    print(f"{'─' * 54}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Separate Suno tracks into stems using Demucs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python separate.py song.mp3
  python separate.py song.mp3 --model htdemucs_6s
  python separate.py song.mp3 --output ./my_stems
  python separate.py *.mp3
        """,
    )
    parser.add_argument("files", nargs="+", help="Audio files to separate")
    parser.add_argument(
        "--model", "-m",
        default="htdemucs_ft",
        choices=list(MODELS.keys()),
        help="Demucs model to use (default: htdemucs_ft)",
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output directory (default: ./separated)",
    )

    args = parser.parse_args()
    separate(args.files, model=args.model, output_dir=args.output)


if __name__ == "__main__":
    main()
