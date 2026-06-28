#!/usr/bin/env python3
"""
SunoSlicer Pro — Server
───────────────────────
Local server that runs the Demucs AI model for stem separation
and serves the browser-based multi-track editor.

Usage:
    python server.py              # Start the server (dev mode)
    python server.py --build      # Build frontend then start

The server runs at http://localhost:7865 (API)
The frontend runs at http://localhost:7866 (Vite)
"""

import os
import sys
import uuid
import time
import json
import shutil
import threading
import subprocess
import argparse
from pathlib import Path

from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS

# ── Config ────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent.resolve()
UPLOAD_DIR = BASE_DIR / "workspace" / "uploads"
OUTPUT_DIR = BASE_DIR / "workspace" / "separated"
DIST_DIR = BASE_DIR / "dist"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".webm"}
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB

MODELS = {
    "htdemucs_ft": {"stems": 4, "desc": "Best vocal isolation (recommended)"},
    "htdemucs": {"stems": 4, "desc": "Faster, good quality"},
    "htdemucs_6s": {"stems": 6, "desc": "6 stems (adds guitar + piano)"},
}

DEFAULT_MODEL = "htdemucs_ft"

# ── Job tracking ──────────────────────────────────────────────

jobs = {}
jobs_lock = threading.Lock()


def get_device_info():
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", torch.cuda.get_device_name(0)
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps", "Apple Silicon"
        else:
            return "cpu", "CPU"
    except ImportError:
        return "cpu", "CPU (torch not found)"


# ── Demucs separation runner ─────────────────────────────────

def run_separation(job_id, input_path, model):
    try:
        with jobs_lock:
            jobs[job_id]["status"] = "processing"
            jobs[job_id]["progress"] = "Loading AI model..."

        job_output = OUTPUT_DIR / job_id
        job_output.mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable, "-m", "demucs",
            "--name", model,
            "--out", str(job_output),
            str(input_path),
        ]

        with jobs_lock:
            jobs[job_id]["progress"] = "Running AI separation..."

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        stderr_lines = []
        for line in process.stderr:
            stderr_lines.append(line.strip())
            if "%" in line:
                with jobs_lock:
                    jobs[job_id]["progress"] = line.strip()

        process.wait()

        if process.returncode != 0:
            error_msg = "\n".join(stderr_lines[-5:])
            with jobs_lock:
                jobs[job_id]["status"] = "error"
                jobs[job_id]["error"] = error_msg
            return

        stem_dir = job_output / model / Path(input_path).stem
        if not stem_dir.exists():
            for d in job_output.rglob("*.wav"):
                stem_dir = d.parent
                break

        if not stem_dir.exists():
            with jobs_lock:
                jobs[job_id]["status"] = "error"
                jobs[job_id]["error"] = "Separation completed but stems not found"
            return

        stems = {}
        for wav_file in sorted(stem_dir.glob("*.wav")):
            stems[wav_file.stem] = str(wav_file)

        with jobs_lock:
            jobs[job_id]["status"] = "complete"
            jobs[job_id]["progress"] = "Done!"
            jobs[job_id]["stems"] = stems
            jobs[job_id]["stem_dir"] = str(stem_dir)
            jobs[job_id]["completed_at"] = time.time()

    except Exception as e:
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(e)


# ── Flask App ─────────────────────────────────────────────────

app = Flask(__name__, static_folder="dist", static_url_path="")
CORS(app)


@app.route("/api/info")
def api_info():
    device, device_name = get_device_info()
    try:
        import demucs
        demucs_installed = True
    except ImportError:
        demucs_installed = False
    return jsonify({"demucs_installed": demucs_installed, "device": device, "device_name": device_name, "models": MODELS, "default_model": DEFAULT_MODEL})


@app.route("/api/separate", methods=["POST"])
def api_separate():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400
    file = request.files["audio"]
    if not file.filename:
        return jsonify({"error": "No filename"}), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Unsupported format: {ext}"}), 400
    model = request.form.get("model", DEFAULT_MODEL)
    if model not in MODELS:
        return jsonify({"error": f"Unknown model: {model}"}), 400

    job_id = str(uuid.uuid4())[:8]
    job_upload_dir = UPLOAD_DIR / job_id
    job_upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename).name
    input_path = job_upload_dir / safe_name
    file.save(str(input_path))

    file_size = input_path.stat().st_size
    if file_size > MAX_FILE_SIZE:
        input_path.unlink()
        return jsonify({"error": "File too large (max 100MB)"}), 400

    with jobs_lock:
        jobs[job_id] = {"status": "queued", "progress": "Queued...", "model": model, "filename": safe_name, "file_size": file_size, "created_at": time.time(), "stems": {}, "error": None}

    thread = threading.Thread(target=run_separation, args=(job_id, str(input_path), model), daemon=True)
    thread.start()
    return jsonify({"job_id": job_id, "status": "queued", "model": model, "filename": safe_name})


@app.route("/api/status/<job_id>")
def api_status(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    response = {"job_id": job_id, "status": job["status"], "progress": job["progress"], "model": job["model"], "filename": job["filename"]}
    if job["status"] == "complete":
        response["stems"] = list(job["stems"].keys())
    if job["status"] == "error":
        response["error"] = job["error"]
    return jsonify(response)


@app.route("/api/stems/<job_id>/<stem_name>")
def api_get_stem(job_id, stem_name):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job["status"] != "complete":
        return jsonify({"error": "Job not complete"}), 400
    stem_path = job["stems"].get(stem_name)
    if not stem_path or not Path(stem_path).exists():
        return jsonify({"error": f"Stem '{stem_name}' not found"}), 404
    return send_file(stem_path, mimetype="audio/wav", as_attachment=True, download_name=f"{stem_name}.wav")


@app.route("/api/jobs")
def api_list_jobs():
    with jobs_lock:
        recent = sorted(jobs.items(), key=lambda x: x[1].get("created_at", 0), reverse=True)[:20]
    return jsonify([{"job_id": jid, "status": j["status"], "filename": j["filename"], "model": j["model"], "stems": list(j["stems"].keys()) if j["status"] == "complete" else []} for jid, j in recent])


@app.route("/api/cleanup/<job_id>", methods=["DELETE"])
def api_cleanup(job_id):
    with jobs_lock:
        job = jobs.pop(job_id, None)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    for d in [UPLOAD_DIR / job_id, OUTPUT_DIR / job_id]:
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    return jsonify({"deleted": job_id})


@app.route("/")
def serve_index():
    if DIST_DIR.exists():
        return send_from_directory("dist", "index.html")
    return """<html><body style="background:#08080f;color:#e0e0ec;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px"><h2>SunoSlicer Pro</h2><p>Frontend not built yet. Run:</p><code style="background:#1a1a2e;padding:8px 16px;border-radius:6px">npm install && npm run build</code><p style="color:#6b7280;font-size:13px">Or use dev mode: <code>npm run dev</code> (runs on port 7866)</p></body></html>"""


@app.route("/<path:path>")
def serve_static(path):
    if DIST_DIR.exists() and (DIST_DIR / path).exists():
        return send_from_directory("dist", path)
    return serve_index()


# ── Main ──────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="SunoSlicer Pro Server")
    parser.add_argument("--port", type=int, default=7865, help="Server port")
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--build", action="store_true", help="Build frontend first")
    args = parser.parse_args()

    print("\n╔══════════════════════════════════════════╗")
    print("║        SunoSlicer Pro — Server           ║")
    print("╚══════════════════════════════════════════╝\n")

    try:
        import demucs
        device, device_name = get_device_info()
        print(f"  ✅  Demucs installed")
        print(f"  🖥️  Compute: {device_name}")
    except ImportError:
        print("  ❌  Demucs not installed")
        print("      Run: pip install -r requirements.txt")

    print(f"\n  🌐  API:  http://{args.host}:{args.port}")
    print(f"  💡  Frontend: npm run dev → http://localhost:7866")
    print(f"  📁  Workspace: {BASE_DIR / 'workspace'}\n")
    print("  Ready — upload a Suno track to separate it")
    print("  Press Ctrl+C to stop\n")
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
