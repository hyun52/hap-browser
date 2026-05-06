// Region classification & annotation segment builder
// Shared between FullRegionView and VariantOnlyView

export function classifyPosition(pos, gene) {
  if (!gene) return 'upstream';
  const gls = gene.gene_start - gene.offset, gle = gene.gene_end - gene.offset;
  for (const f of gene.features) {
    if (!f.attrs?.Parent) continue;
    const isT = gene.features.some(m => m.type === 'mRNA' && m.attrs?.ID === f.attrs.Parent && m.attrs?.Locus_id === gene.id);
    if (!isT) continue;
    if ((f.type === 'CDS' || f.type === 'exon') && pos >= f.start && pos <= f.end) return 'cds';
    if (f.type === 'five_prime_UTR' && pos >= f.start && pos <= f.end) return 'utr5';
    if (f.type === 'three_prime_UTR' && pos >= f.start && pos <= f.end) return 'utr3';
  }
  if (pos >= gls && pos <= gle) return 'intron';
  return pos < gls ? 'upstream' : 'downstream';
}

export const REGION_COL = { cds: '#16a34a', utr5: '#7c3aed', utr3: '#a855f7', intron: '#94a3b8', upstream: '#cbd5e1', downstream: '#cbd5e1' };
export const REGION_LBL = { cds: 'CDS', utr5: "5'UTR", utr3: "3'UTR", intron: 'Intron', upstream: 'Upstream', downstream: 'Downstream' };

/**
 * Build merged annotation segments from MSA columns + regionCache.
 * Columns can be { type: 'ref', pos } or { type: 'ins', afterPos, insIdx }.
 * Insertion columns are emitted as their own segments with type='ins'.
 * Returns: [{ type, startIdx, endIdx, startPos, endPos }]
 */
export function buildAnnotSegments(columns, regionCache) {
  if (!columns.length) return [];
  const segs = [];
  let cur = null;

  const flush = () => { if (cur) { segs.push({ ...cur }); cur = null; } };

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.type === 'ins') {
      flush();
      // Consecutive ins columns at same afterPos merge into one ins segment
      if (segs.length > 0 && segs[segs.length - 1].type === 'ins' && segs[segs.length - 1].afterPos === col.afterPos) {
        segs[segs.length - 1].endIdx = i;
      } else {
        segs.push({ type: 'ins', startIdx: i, endIdx: i, afterPos: col.afterPos });
      }
      continue;
    }
    // ref column
    const t = regionCache[col.pos] || 'upstream';
    if (!cur) {
      cur = { type: t, startIdx: i, startPos: col.pos, endIdx: i, endPos: col.pos };
    } else if (t === cur.type) {
      cur.endIdx = i;
      cur.endPos = col.pos;
    } else {
      flush();
      cur = { type: t, startIdx: i, startPos: col.pos, endIdx: i, endPos: col.pos };
    }
  }
  flush();
  return segs;
}
