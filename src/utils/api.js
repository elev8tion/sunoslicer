const API_BASE = "/api";

export async function getServerInfo() {
  const res = await fetch(`${API_BASE}/info`);
  if (!res.ok) throw new Error("Server not reachable");
  return res.json();
}

export async function startSeparation(file, model = "htdemucs_ft") {
  const form = new FormData();
  form.append("audio", file);
  form.append("model", model);
  const res = await fetch(`${API_BASE}/separate`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
}

export async function checkStatus(jobId) {
  const res = await fetch(`${API_BASE}/status/${jobId}`);
  if (!res.ok) throw new Error("Status check failed");
  return res.json();
}

export async function fetchStem(jobId, stemName) {
  const res = await fetch(`${API_BASE}/stems/${jobId}/${stemName}`);
  if (!res.ok) throw new Error(`Failed to fetch stem: ${stemName}`);
  return res.arrayBuffer();
}

export async function listJobs() {
  const res = await fetch(`${API_BASE}/jobs`);
  if (!res.ok) return [];
  return res.json();
}
