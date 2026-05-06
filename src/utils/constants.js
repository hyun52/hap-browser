// ─── Color Palettes ───
export const BASE_COL = {
  A: '#1d6fba', T: '#15803d', G: '#b35a00', C: '#c41c1c',
  del: '#9a9690', ins: '#7c3aed', N: '#c8c5be',
};
export const BASE_BG = {
  A: '#d6e8f7', T: '#d4eddc', G: '#f5e6cc', C: '#fad6d6', N: '#e8e6e0',
};
export const HAP_COLORS = [
  '#2563eb', '#15803d', '#b35a00', '#c41c1c',
  '#7c3aed', '#be185d', '#0f766e', '#92400e',
  '#4f46e5', '#059669', '#d97706', '#dc2626',
];
export const ANNOT_COL = {
  cds: '#1a7a3c', utr: '#6b3fa0', intron: '#8a8a8a',
  nbCds: '#c97c1a', nbUtr: '#a06030', nbIntr: '#c0a060',
};

// ─── Track Heights (px) ───
export const TH = { ruler: 22, annot: 56, ref: 26, sample: 28 };

// ─── Haplotype Computation ───
export const MIN_DEPTH_FOR_VARIANT = 5;   // minimum read depth to call a variant
export const MIN_ALT_FREQ = 0.2;          // minimum alt allele frequency

// ─── Monospace Font ───
export const MONO = "'JetBrains Mono', monospace";
