/**
 * Parse FASTA text → sequence string (uppercase)
 */
export function parseFASTA(text) {
  return text
    .split('\n')
    .filter(l => !l.startsWith('>'))
    .join('')
    .toUpperCase();
}

/**
 * Parse GFF3 text → feature array
 * Each feature: { type, start, end, strand, attrs: {key: value} }
 */
export function parseGFF3(text) {
  const features = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const p = line.split('\t');
    if (p.length < 9) continue;
    const [, , type, start, end, , strand, , attrStr] = p;
    const attrs = {};
    for (const kv of attrStr.split(';')) {
      const eq = kv.indexOf('=');
      if (eq < 0) continue;
      const key = decodeURIComponent(kv.slice(0, eq).trim());
      const val = decodeURIComponent(kv.slice(eq + 1).trim());
      attrs[key] = val;
    }
    features.push({ type, start: +start, end: +end, strand, attrs });
  }
  return features;
}
