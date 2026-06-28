export const TRACK_COLORS = [
  { wave: "#38bdf8", bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.25)", label: "#38bdf8" },
  { wave: "#f97316", bg: "rgba(249,115,22,0.08)", border: "rgba(249,115,22,0.25)", label: "#f97316" },
  { wave: "#a855f7", bg: "rgba(168,85,247,0.08)", border: "rgba(168,85,247,0.25)", label: "#a855f7" },
  { wave: "#22c55e", bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)",  label: "#22c55e" },
  { wave: "#eab308", bg: "rgba(234,179,8,0.08)",  border: "rgba(234,179,8,0.25)",  label: "#eab308" },
  { wave: "#ec4899", bg: "rgba(236,72,153,0.08)", border: "rgba(236,72,153,0.25)", label: "#ec4899" },
];

export const STEM_NAMES = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  guitar: "Guitar",
  piano: "Piano",
};

export function guessStemName(filename) {
  const lower = filename.toLowerCase();
  for (const key of Object.keys(STEM_NAMES)) {
    if (lower.includes(key)) return STEM_NAMES[key];
  }
  return filename.replace(/\.[^.]+$/, "");
}
