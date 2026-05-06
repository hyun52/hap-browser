import { MIN_DEPTH_FOR_VARIANT } from './constants.js';

/**
 * Returns sample's allele from the enc schema (v83.1 compressed schema supported)
 * Handles both pd.alleles (legacy schema) and pd.enc + pd.alt (new schema)
 */
export function getAlleleForSample(pd, sampleIdOrIdx, sampleList, refBase) {
  if (!pd) return refBase;

  // New schema: enc + alt
  if (pd.enc !== undefined) {
    const si = typeof sampleIdOrIdx === 'number'
      ? sampleIdOrIdx
      : (sampleList ? sampleList.indexOf(sampleIdOrIdx) : -1);
    if (si < 0 || si >= pd.enc.length) return refBase;
    const c = pd.enc[si];
    if (c === '0') return refBase;
    if (c === '-') return '-';
    const altIdx = parseInt(c) - 1;
    return altIdx < (pd.alt || []).length ? pd.alt[altIdx] : refBase;
  }

  // Legacy schema: alleles dict (backward compat)
  if (pd.alleles) {
    const sid = typeof sampleIdOrIdx === 'string'
      ? sampleIdOrIdx
      : (sampleList ? sampleList[sampleIdOrIdx] : null);
    return sid ? (pd.alleles[sid] ?? refBase) : refBase;
  }

  return refBase;
}

/**
 * Compute haplotypes — 4 combinations: (Gene|CDS) × (Gap Include|Exclude)
 *
 * Gap Include: no-coverage and deletion are treated as variants (different from ref).
 *              Samples with different gap patterns → different haplotypes.
 *
 * Gap Exclude: only SNPs matter for haplotype classification.
 *              no-coverage/deletion positions are ignored when comparing patterns.
 *              Two samples with same SNPs but different coverage → same haplotype.
 */
export function computeHaplotypes({
  refSeq, regionLength, geneLocalStart, geneLocalEnd,
  sampleIds, pileupCache,
  features = [], geneId = '',
}) {
  // 1) Find CDS regions
  const targetMrnaIds = new Set();
  features.forEach(f => {
    if (f.type === 'mRNA' && f.attrs?.Locus_id === geneId) targetMrnaIds.add(f.attrs.ID);
  });
  const cdsRanges = [];
  features.forEach(f => {
    if ((f.type === 'CDS' || f.type === 'exon') && f.attrs?.Parent && targetMrnaIds.has(f.attrs.Parent))
      cdsRanges.push({ start: f.start, end: f.end });
  });
  if (!cdsRanges.length) cdsRanges.push({ start: geneLocalStart, end: geneLocalEnd });

  // 2) Transcript range (5'UTR ~ 3'UTR)
  let txStart = geneLocalStart, txEnd = geneLocalEnd;
  features.forEach(f => {
    if (!f.attrs?.Parent || !targetMrnaIds.has(f.attrs.Parent)) return;
    if (['five_prime_UTR','three_prime_UTR','CDS','exon'].includes(f.type)) {
      if (f.start < txStart) txStart = f.start;
      if (f.end > txEnd) txEnd = f.end;
    }
  });
  features.forEach(f => {
    if (f.type === 'mRNA' && targetMrnaIds.has(f.attrs?.ID)) {
      if (f.start < txStart) txStart = f.start;
      if (f.end > txEnd) txEnd = f.end;
    }
  });

  const cdsSet = new Set();
  for (const r of cdsRanges) for (let p = r.start; p <= r.end; p++) cdsSet.add(p);
  const geneRange = { start: txStart, end: txEnd };

  // 3) Scan entire region for allele data
  const scanStart = 1;
  const scanEnd = regionLength;
  const positionData = [];

  for (let pos = scanStart; pos <= scanEnd; pos++) {
    const ref = refSeq[pos - 1];
    if (!ref || ref === 'N') continue;

    let hasSnp = false, hasDel = false, hasNoCov = false, hasIns = false;
    const alleles = {};

    for (const sid of sampleIds) {
      const pileup = pileupCache[sid];
      if (!pileup) { alleles[sid] = '-'; hasNoCov = true; continue; }
      const p = pileup[String(pos)];
      if (!p) { alleles[sid] = '-'; hasNoCov = true; continue; }

      const tot = p.A + p.T + p.G + p.C + (p.del || 0) + (p.ins || 0);
      if (tot === 0) { alleles[sid] = '-'; hasNoCov = true; continue; }
      if (tot < MIN_DEPTH_FOR_VARIANT) {
        // Low depth: treat as ref (not confident enough to call variant, but not truly unmapped)
        const bases = { A: p.A, T: p.T, G: p.G, C: p.C };
        const dom = Object.entries(bases).sort((a, b) => b[1] - a[1])[0][0];
        alleles[sid] = dom;
        // Don't set any variant flag — this position is treated as ref for this sample
        continue;
      }
      if ((p.del || 0) > tot * 0.3) { alleles[sid] = 'D'; hasDel = true; continue; }

      const bases = { A: p.A, T: p.T, G: p.G, C: p.C };
      const sorted = Object.entries(bases).sort((a, b) => b[1] - a[1]);
      const dom = sorted[0][0];

      // Check for dominant insertion
      let allele = dom;
      if (p.ins_seqs && (p.ins || 0) > 0) {
        // Find dominant insertion sequence
        const insEntries = Object.entries(p.ins_seqs).sort((a, b) => b[1] - a[1]);
        if (insEntries.length > 0 && insEntries[0][1] >= 2) {
          // Dominant insertion with at least 2 reads support
          allele = dom + '+' + insEntries[0][0];
          hasIns = true;
        }
      }

      alleles[sid] = allele;
      if (dom !== ref && sorted[0][1] >= MIN_DEPTH_FOR_VARIANT) hasSnp = true;
    }

    if (hasSnp || hasDel || hasNoCov || hasIns) {
      positionData.push({
        pos, alleles, hasSnp, hasDel, hasNoCov, hasIns,
        inGene: pos >= geneRange.start && pos <= geneRange.end,
        inCds: cdsSet.has(pos),
      });
    }
  }

  const alleleMap = new Map();
  positionData.forEach(pd => alleleMap.set(pd.pos, pd));

  // 4) Build position lists using flags: { snp, indel, gap }
  // target: 'gene' | 'cds' | 'region'
  const getPositions = (target, flags) => {
    return positionData
      .filter(pd => {
        if (target === 'cds' && !pd.inCds) return false;
        if (target === 'gene' && !pd.inGene) return false;
        // Must match at least one enabled flag
        let match = false;
        if (flags.snp && pd.hasSnp) match = true;
        if (flags.indel && (pd.hasIns || pd.hasDel)) match = true;
        if (flags.gap && pd.hasNoCov) match = true;
        return match;
      })
      .map(pd => pd.pos);
  };

  // 5) Build haplotypes
  const buildHaps = (classifyPositions, flags) => {
    if (!classifyPositions.length) {
      return [{
        id: 'Hap1', label: 'Haplotype 1',
        samples: [...sampleIds], pattern: '',
        nSnp: 0, nGap: 0, nVariants: 0, nSamples: sampleIds.length,
      }];
    }

    const refPattern = classifyPositions.map(p => refSeq[p - 1]).join('');

    const patternMap = new Map();
    for (const sid of sampleIds) {
      const rawParts = [];
      for (const p of classifyPositions) {
        const pd = alleleMap.get(p);
        rawParts.push(pd ? (pd.alleles[sid] || refSeq[p - 1]) : refSeq[p - 1]);
      }

      // Mask out disabled variant types → treat as ref
      const classifyParts = rawParts.map((a, i) => {
        if (a === '-' && !flags.gap) return refPattern[i];           // no-coverage masked
        if (a === 'D' && !flags.indel) return refPattern[i];         // deletion masked
        if (a.includes('+') && !flags.indel) return a.split('+')[0]; // insertion stripped
        if (a !== '-' && a !== 'D' && !a.includes('+') && a !== refPattern[i] && !flags.snp) return refPattern[i]; // SNP masked
        return a;
      });
      const classifyPattern = classifyParts.join('');

      if (!patternMap.has(classifyPattern)) {
        patternMap.set(classifyPattern, { samples: [] });
      }
      patternMap.get(classifyPattern).samples.push(sid);
    }

    const entries = [...patternMap.entries()];
    entries.sort((a, b) => {
      const dA = hamming(a[0], refPattern), dB = hamming(b[0], refPattern);
      return dA !== dB ? dA - dB : b[1].samples.length - a[1].samples.length;
    });

    return entries.map(([classPattern, { samples }], i) => {
      let nSnp = 0, nGap = 0, nIns = 0;
      const sid0 = samples[0];
      for (let j = 0; j < classifyPositions.length; j++) {
        const p = classifyPositions[j];
        const pd = alleleMap.get(p);
        let al = pd ? (pd.alleles[sid0] || refSeq[p - 1]) : refSeq[p - 1];
        // Apply same masking
        if (al === '-' && !flags.gap) al = refSeq[p - 1];
        if (al === 'D' && !flags.indel) al = refSeq[p - 1];
        if (al.includes('+') && !flags.indel) al = al.split('+')[0];
        if (al !== '-' && al !== 'D' && !al.includes('+') && al !== refSeq[p - 1] && !flags.snp) al = refSeq[p - 1];
        const r = refSeq[p - 1];
        if (al === r) continue;
        if (al === '-' || al === 'D') nGap++;
        else if (al.includes('+')) nIns++;
        else nSnp++;
      }
      return {
        id: `Hap${i + 1}`, label: `Haplotype ${i + 1}`,
        samples, pattern: classPattern,
        nSnp, nGap, nIns, nVariants: nSnp + nGap + nIns, nSamples: samples.length,
      };
    });
  };

  // 6) Pre-compute all flag combinations: 7 combos × 2 targets = 14
  // Key format: "{target}_{s}{i}{g}" where s/i/g = 1 or 0
  const combos = {};
  const flagCombos = [];
  for (let s = 0; s <= 1; s++)
    for (let i = 0; i <= 1; i++)
      for (let g = 0; g <= 1; g++) {
        if (s === 0 && i === 0 && g === 0) continue; // skip all-off
        flagCombos.push({ snp: !!s, indel: !!i, gap: !!g, key: `${s}${i}${g}` });
      }

  for (const target of ['gene', 'cds']) {
    for (const fc of flagCombos) {
      const key = `${target}_${fc.key}`;
      const positions = getPositions(target, fc);
      const haplotypes = buildHaps(positions, fc);
      combos[key] = { haplotypes, variantPositions: positions };
    }
  }

  // Also store entire-region variant positions for View (all types)
  combos._regionPositionData = positionData;

  return combos;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

export function getDominantAllele(pileup, pos, refBase) {
  if (!pileup) return { base: '-', isRef: false, depth: 0, isDel: false, isIns: false, isNoCov: true, insSeqs: null };
  const p = pileup[String(pos)];
  if (!p) return { base: '-', isRef: false, depth: 0, isDel: false, isIns: false, isNoCov: true, insSeqs: null };
  const tot = p.A + p.T + p.G + p.C + (p.del || 0) + (p.ins || 0);
  if (tot === 0) return { base: '-', isRef: false, depth: 0, isDel: false, isIns: false, isNoCov: true, insSeqs: null };
  const bases = { A: p.A, T: p.T, G: p.G, C: p.C };
  const sorted = Object.entries(bases).sort((a, b) => b[1] - a[1]);
  const dom = sorted[0][0];
  const isDel = (p.del || 0) > tot * 0.3;
  const isIns = (p.ins || 0) > 0;
  const insSeqs = p.ins_seqs || null;
  return { base: isDel ? '-' : dom, isRef: dom === refBase && !isDel, depth: tot, counts: p, isDel, isIns, isNoCov: false, insSeqs };
}

/**
 * Get dominant insertion sequence for a sample at a position.
 * Returns the insertion string (e.g., "ATG") or null if no dominant insertion.
 */
export function getDominantInsSeq(pileup, pos) {
  if (!pileup) return null;
  const p = pileup[String(pos)];
  if (!p || !p.ins_seqs || !(p.ins || 0)) return null;
  const tot = p.A + p.T + p.G + p.C + (p.del || 0) + (p.ins || 0);
  if (tot < MIN_DEPTH_FOR_VARIANT) return null;
  const entries = Object.entries(p.ins_seqs).sort((a, b) => b[1] - a[1]);
  if (entries.length > 0 && entries[0][1] >= 2) return entries[0][0];
  return null;
}

/**
 * Build MSA columns from positions + pileup data.
 * For each position where at least one sample has a dominant insertion,
 * insertion columns are added after that position.
 *
 * Returns: {
 *   msaColumns: [ { type: 'ref', pos } | { type: 'ins', afterPos, insIdx } ],
 *   insMaxLen: { [pos]: maxInsertionLength },
 *   sampleInsMap: { [sampleId]: { [pos]: "ATGC..." } }  // dominant ins seq per sample per pos
 * }
 */
export function buildMsaColumns(positions, sampleIds, getPileup, geneId, includeIns = true) {
  // 1. Scan all positions for insertions across all samples
  const insMaxLen = {};       // afterPos → max insertion length
  const sampleInsMap = {};    // sid → { pos → insSeq }

  if (includeIns) {
    for (const sid of sampleIds) {
      const pileup = getPileup(geneId, sid);
      sampleInsMap[sid] = {};
      for (const pos of positions) {
        const insSeq = getDominantInsSeq(pileup, pos);
        if (insSeq) {
          sampleInsMap[sid][pos] = insSeq;
          if (!insMaxLen[pos] || insSeq.length > insMaxLen[pos]) {
            insMaxLen[pos] = insSeq.length;
          }
        }
      }
    }
  } else {
    for (const sid of sampleIds) {
      sampleInsMap[sid] = {};
    }
  }

  // 2. Build MSA columns array
  const msaColumns = [];
  for (const pos of positions) {
    // Reference column
    msaColumns.push({ type: 'ref', pos });
    // Insertion columns (only if includeIns and any sample has insertion after this position)
    if (includeIns && insMaxLen[pos]) {
      for (let i = 0; i < insMaxLen[pos]; i++) {
        msaColumns.push({ type: 'ins', afterPos: pos, insIdx: i });
      }
    }
  }

  return { msaColumns, insMaxLen, sampleInsMap };
}

/**
 * Compute haplotypes on-the-fly for a custom position range.
 * Uses pre-computed positionData from combos._regionPositionData.
 *
 * @param {Array} positionData - from combos._regionPositionData
 * @param {string} refSeq - reference sequence
 * @param {Array} sampleIds - sample ID list
 * @param {Object} flags - { snp, indel, gap }
 * @param {number} posStart - start of custom range (local coordinate)
 * @param {number} posEnd - end of custom range (local coordinate)
 * @returns {{ haplotypes, variantPositions }}
 */
export function computeCustomHaplotypes(positionData, refSeq, sampleIds, flags, posStart, posEnd, extraRanges = []) {
  const alleleMap = new Map();
  positionData.forEach(pd => alleleMap.set(pd.pos, pd));

  // Union of all ranges
  const ranges = [{ start: posStart, end: posEnd }, ...extraRanges];

  const variantPositions = positionData
    .filter(pd => {
      const inRange = ranges.some(r => pd.pos >= r.start && pd.pos <= r.end);
      if (!inRange) return false;
      let match = false;
      if (flags.snp && pd.hasSnp) match = true;
      if (flags.indel && (pd.hasIns || pd.hasDel)) match = true;
      if (flags.gap && pd.hasNoCov) match = true;
      return match;
    })
    .map(pd => pd.pos);

  if (!variantPositions.length) {
    return {
      haplotypes: [{ id: 'Hap1', label: 'Haplotype 1', samples: [...sampleIds],
        pattern: '', nSnp: 0, nGap: 0, nIns: 0, nVariants: 0, nSamples: sampleIds.length }],
      variantPositions,
    };
  }

  const refPattern = variantPositions.map(p => refSeq[p - 1]).join('');
  const patternMap = new Map();

  for (let si = 0; si < sampleIds.length; si++) {
    const sid = sampleIds[si];
    const rawParts = variantPositions.map(p => {
      const pd = alleleMap.get(p);
      return getAlleleForSample(pd, si, sampleIds, refSeq[p - 1]);
    });
    const classifyParts = rawParts.map((a, i) => {
      const rp = refPattern[i];
      if (a === '-' && !flags.gap) return rp;
      if (a === 'D' && !flags.indel) return rp;
      if (a.includes('+') && !flags.indel) return a.split('+')[0];
      if (a !== '-' && a !== 'D' && !a.includes('+') && a !== rp && !flags.snp) return rp;
      return a;
    });
    const cp = classifyParts.join('');
    if (!patternMap.has(cp)) patternMap.set(cp, { samples: [] });
    patternMap.get(cp).samples.push(sid);
  }

  const entries = [...patternMap.entries()];
  entries.sort((a, b) => {
    const dA = hamming(a[0], refPattern), dB = hamming(b[0], refPattern);
    return dA !== dB ? dA - dB : b[1].samples.length - a[1].samples.length;
  });

  const haplotypes = entries.map(([classPattern, { samples }], i) => {
    let nSnp = 0, nGap = 0, nIns = 0;
    const si0 = sampleIds.indexOf(samples[0]);
    for (let j = 0; j < variantPositions.length; j++) {
      const p = variantPositions[j];
      const pd = alleleMap.get(p);
      let al = getAlleleForSample(pd, si0, sampleIds, refSeq[p - 1]);
      const rp = refPattern[j];
      if (al === '-' && !flags.gap) al = rp;
      if (al === 'D' && !flags.indel) al = rp;
      if (al.includes('+') && !flags.indel) al = al.split('+')[0];
      if (al !== '-' && al !== 'D' && !al.includes('+') && al !== rp && !flags.snp) al = rp;
      if (al === rp) continue;
      if (al === '-' || al === 'D') nGap++;
      else if (al.includes('+')) nIns++;
      else nSnp++;
    }
    return {
      id: `Hap${i + 1}`, label: `Haplotype ${i + 1}`,
      samples, pattern: classPattern,
      nSnp, nGap, nIns, nVariants: nSnp + nGap + nIns, nSamples: samples.length,
    };
  });

  return { haplotypes, variantPositions };
}
