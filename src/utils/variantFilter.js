/**
 * variantFilter.js
 * ----------------
 * User-adjustable variant filtering, applied in the browser on top of the
 * precomputed per-gene summary.
 *
 * The filter is a masking layer: a cell whose read support fails a threshold is
 * shown as filtered rather than as the call it would otherwise have been, and is
 * withheld from haplotype classification. Nothing else about the display changes,
 * and the hover tooltip always reports the underlying counts unaltered.
 *
 * Both thresholds are disabled at zero, so the default state reproduces the
 * precomputed summary exactly.
 *
 *   minDepth  Cells below this total read depth are filtered. Shown in a darker
 *             grey than absent coverage, since the two are not the same thing.
 *
 *   hetFreq   Cells at which the second most frequent allele reaches this
 *             fraction of the two commonest alleles are reported as
 *             heterozygous ('H') instead of being collapsed onto the major
 *             allele. In an inbred panel a cluster of such calls shared by
 *             several accessions more often indicates reads mismapped from a
 *             paralogous region than genuine residual heterozygosity, so making
 *             the state visible is itself diagnostic.
 */

export const DEFAULT_VARIANT_FILTER = {
  minDepth: 0,
  hetFreq: 0,
};

export function isDefaultVariantFilter(vf) {
  if (!vf) return true;
  return !vf.minDepth && !vf.hetFreq;
}

// Cell states produced by the filter.
export const CELL_OK = 0;      // call stands
export const CELL_NOCOV = 1;   // no reads
export const CELL_LOWDEPTH = 2;// reads present but below the depth threshold
export const CELL_HET = 3;     // two alleles above the heterozygous threshold

export const CELL_REASON = {
  [CELL_NOCOV]: 'No reads mapped to this position',
  [CELL_LOWDEPTH]: 'Below the minimum depth threshold',
  [CELL_HET]: 'Heterozygous: two alleles above the threshold',
};

/**
 * Classify one cell from raw per-base counts.
 * `p` is the pileup entry for one sample at one position, or null.
 */
export function classifyCell(p, vf) {
  if (!p) return CELL_NOCOV;

  const A = p.A || 0, T = p.T || 0, G = p.G || 0, C = p.C || 0;
  const tot = A + T + G + C + (p.del || 0) + (p.ins || 0);
  if (tot === 0) return CELL_NOCOV;

  if (vf.minDepth > 0 && tot < vf.minDepth) return CELL_LOWDEPTH;

  if (vf.hetFreq > 0) {
    const sorted = [A, T, G, C].sort((a, b) => b - a);
    const [first, second] = sorted;
    if (second >= 2 && second / (first + second) >= vf.hetFreq) return CELL_HET;
  }

  return CELL_OK;
}

/**
 * Rebuild positionData under the filter.
 *
 * Filtered cells are encoded as absent so that they cannot define a haplotype.
 * Their reason is not stored here: the canvas classifies cells directly from the
 * raw counts when drawing, which also covers positions that carry no variant and
 * are therefore absent from positionData altogether.
 *
 * getRawPileup(sampleId) returns the raw count object for the gene, or null.
 * The enc/alt encoding is preserved so downstream consumers work unchanged.
 */
export function applyVariantFilter({ positionData, refSeq, sampleIds, getRawPileup, vf }) {
  const pileups = sampleIds.map(sid => getRawPileup(sid));
  const n = sampleIds.length;
  const out = [];

  for (const pd of positionData) {
    const ref = pd.ref || refSeq[pd.pos - 1];
    if (!ref || ref === 'N') continue;

    const enc = pd.enc || '';
    let changed = false;
    const raw = new Array(n);

    for (let i = 0; i < n; i++) {
      const pileup = pileups[i];
      const p = pileup ? pileup[String(pd.pos)] : null;
      const state = classifyCell(p, vf);

      if (state !== CELL_OK) {
        raw[i] = '-';
        if (i < enc.length && enc[i] !== '-') changed = true;
        continue;
      }
      // Unfiltered: keep the precomputed call verbatim.
      const c = i < enc.length ? enc[i] : '0';
      if (c === '0') raw[i] = ref;
      else if (c === '-') raw[i] = '-';
      else {
        const ai = parseInt(c, 10) - 1;
        raw[i] = ai < (pd.alt || []).length ? pd.alt[ai] : ref;
      }
    }

    if (!changed) { out.push(pd); continue; }

    // Re-encode and re-derive the variant flags, since masking may have removed
    // the only sample that carried a given variant type at this position.
    let hasSnp = false, hasDel = false, hasNoCov = false, hasIns = false;
    const seen = new Map();
    for (const a of raw) {
      if (a === '-') { hasNoCov = true; continue; }
      if (a === 'D') hasDel = true;
      else if (a.includes('+')) { hasIns = true; if (a[0] !== ref) hasSnp = true; }
      else if (a !== ref) hasSnp = true;
      if (a !== ref && !seen.has(a)) seen.set(a, seen.size + 1);
    }

    if (!(hasSnp || hasDel || hasNoCov || hasIns)) continue;

    let encOut = '';
    for (const a of raw) {
      if (a === ref) encOut += '0';
      else if (a === '-') encOut += '-';
      else {
        const idx = seen.get(a);
        encOut += (idx && idx <= 9) ? String(idx) : '1';
      }
    }

    out.push({
      ...pd,
      alt: [...seen.keys()],
      enc: encOut,
      hasSnp, hasDel, hasNoCov, hasIns,
      f: (hasSnp ? 1 : 0) | (hasDel ? 2 : 0) | (hasNoCov ? 4 : 0) | (hasIns ? 8 : 0)
        | (pd.inGene ? 16 : 0) | (pd.inCds ? 32 : 0),
    });
  }

  return out;
}

// ── Haplotype assembly from positionData ────────────────────────────────────

function decode(pd, si) {
  const enc = pd.enc || '';
  const c = si < enc.length ? enc[si] : '0';
  if (c === '0') return pd.ref;
  if (c === '-') return '-';
  const idx = parseInt(c, 10) - 1;
  return idx < (pd.alt || []).length ? pd.alt[idx] : pd.ref;
}

function hamming(a, b) {
  let d = 0;
  const L = Math.min(a.length, b.length);
  for (let i = 0; i < L; i++) if (a[i] !== b[i]) d++;
  return d;
}

function buildHaps(selected, refSeq, sampleIds, flags) {
  if (!selected.length) {
    return [{
      id: 'Hap1', label: 'Haplotype 1', samples: [...sampleIds], pattern: '',
      nSnp: 0, nGap: 0, nIns: 0, nVariants: 0, nSamples: sampleIds.length,
    }];
  }

  const refPattern = selected.map(pd => pd.ref || refSeq[pd.pos - 1]).join('');

  const mask = (a, r) => {
    if (a === '-' && !flags.gap) return r;
    if (a === 'D' && !flags.indel) return r;
    if (a.includes('+') && !flags.indel) return a.split('+')[0];
    if (a !== '-' && a !== 'D' && !a.includes('+') && a !== r && !flags.snp) return r;
    return a;
  };

  const patternMap = new Map();
  for (let si = 0; si < sampleIds.length; si++) {
    let pattern = '';
    for (let j = 0; j < selected.length; j++) {
      pattern += mask(decode(selected[j], si), refPattern[j]);
    }
    if (!patternMap.has(pattern)) patternMap.set(pattern, []);
    patternMap.get(pattern).push(sampleIds[si]);
  }

  const entries = [...patternMap.entries()].sort((a, b) => {
    const dA = hamming(a[0], refPattern), dB = hamming(b[0], refPattern);
    return dA !== dB ? dA - dB : b[1].length - a[1].length;
  });

  return entries.map(([pattern, samples], i) => {
    let nSnp = 0, nGap = 0, nIns = 0;
    const si0 = sampleIds.indexOf(samples[0]);
    for (let j = 0; j < selected.length; j++) {
      const r = refPattern[j];
      const al = mask(decode(selected[j], si0), r);
      if (al === r) continue;
      if (al === '-' || al === 'D') nGap++;
      else if (al.includes('+')) nIns++;
      else nSnp++;
    }
    return {
      id: `Hap${i + 1}`, label: `Haplotype ${i + 1}`,
      samples, pattern,
      nSnp, nGap, nIns, nVariants: nSnp + nGap + nIns,
      nSamples: samples.length,
    };
  });
}

/**
 * Rebuild the full combos object (7 flag combinations × 2 targets) from
 * positionData, matching the shape produced by scripts/precompute.py.
 */
export function buildCombosFromPositionData(positionData, refSeq, sampleIds) {
  const combos = {};
  for (const target of ['gene', 'cds']) {
    for (let s = 0; s <= 1; s++) {
      for (let i = 0; i <= 1; i++) {
        for (let g = 0; g <= 1; g++) {
          if (!s && !i && !g) continue;
          const flags = { snp: !!s, indel: !!i, gap: !!g };
          const selected = positionData.filter(pd => {
            if (target === 'cds' && !pd.inCds) return false;
            if (target === 'gene' && !pd.inGene) return false;
            if (flags.snp && pd.hasSnp) return true;
            if (flags.indel && (pd.hasIns || pd.hasDel)) return true;
            if (flags.gap && pd.hasNoCov) return true;
            return false;
          });
          combos[`${target}_${s}${i}${g}`] = {
            haplotypes: buildHaps(selected, refSeq, sampleIds, flags),
            variantPositions: selected.map(pd => pd.pos),
          };
        }
      }
    }
  }
  combos._regionPositionData = positionData;
  return combos;
}
