/**
 * markerDesign.js
 * KASP (SNP) and InDel marker-design algorithm (incorporating Gemini recommendations)
 *
 * KASP marker design criteria:
 *  - ASP length: 21–25 bp (excluding tail), 3' end = SNP base
 *  - Tm: 62–65 °C (Nearest-Neighbor), Tm diff between two ASPs ≤ 1 °C recommended
 *  - GC content: 40~60%
 *  - 3' GC clamp: 1–3 G/C within the last 5 bp of the 3' end; no ≥3 consecutive G/C
 *  - Amplicon: 50–150 bp (shorter is preferred for KASP efficiency)
 *  - CP length: 20–30 bp
 *  - Neighboring-variant masking: other SNP/InDel within primer region → replaced with N
 *  - Hairpin / Self-dimer / Cross-dimer QC
 *  - FAM tail (ASP1), HEX tail (ASP2) annotations
 *
 * Tm calculation:
 *  - Nearest-Neighbor thermodynamics (SantaLucia 1998, PNAS 95:1460) — unified
 *    parameter set (1 M NaCl reference).
 *  - Salt correction (Owczarzy 2008, Biochemistry 47:5336) — Na⁺ / Mg²⁺ /
 *    Reflects standard PCR buffer conditions including dNTP.
 *  - Default conditions (KASP standard): [oligo]=250 nM, [Na⁺]=50 mM, [Mg²⁺]=1.5 mM,
 *    [dNTP]=0.2 mM.
 *  - calcTm(seq, opts?) accepts {Na, Mg, dNTP, primer} in opts.
 */

// FAM / HEX tail sequences (KASP standard)
export const FAM_TAIL = 'GAAGGTGACCAAGTTCATGCT';
export const HEX_TAIL = 'GAAGGTCGGAGTCAACGGATT';

// ─── Thermodynamics (Nearest-Neighbor, SantaLucia 1998) ──────────────────────
const NN_PARAMS = {
  AA: { dH: -7.9, dS: -22.2 }, TT: { dH: -7.9, dS: -22.2 },
  AT: { dH: -7.2, dS: -20.4 }, TA: { dH: -7.2, dS: -21.3 },
  CA: { dH: -8.5, dS: -22.7 }, TG: { dH: -8.5, dS: -22.7 },
  GT: { dH: -8.4, dS: -22.4 }, AC: { dH: -8.4, dS: -22.4 },
  CT: { dH: -7.8, dS: -21.0 }, AG: { dH: -7.8, dS: -21.0 },
  GA: { dH: -8.2, dS: -22.2 }, TC: { dH: -8.2, dS: -22.2 },
  CG: { dH: -10.6, dS: -27.2 }, GC: { dH: -9.8, dS: -24.4 },
  GG: { dH: -8.0, dS: -19.9 }, CC: { dH: -8.0, dS: -19.9 },
};
const R_GAS = 1.987;                 // cal/(mol·K)
const DEFAULT_PRIMER = 250e-9;       // 250 nM (KASP standard)
const DEFAULT_NA     = 0.050;        // 50 mM NaCl-equiv
const DEFAULT_MG     = 0.0015;       // 1.5 mM MgCl2
const DEFAULT_DNTP   = 0.0002;       // 0.2 mM dNTP (chelates Mg)

/**
 * Tm calculation (°C).
 *
 * @param {string} seq   - DNA sequence (A/T/G/C only; others replaced with A)
 * @param {object} [opts]
 * @param {number} [opts.Na=0.050]   - Na⁺ (M)
 * @param {number} [opts.Mg=0.0015]  - Mg²⁺ total (M)
 * @param {number} [opts.dNTP=0.0002]- dNTP total (M) — assumes 1:1 chelation with Mg
 * @param {number} [opts.primer=250e-9] - primer concentration (M)
 * @returns {number} Tm in °C, rounded to 0.1
 */
export function calcTm(seq, opts = {}) {
  const {
    Na = DEFAULT_NA,
    Mg = DEFAULT_MG,
    dNTP = DEFAULT_DNTP,
    primer = DEFAULT_PRIMER,
  } = opts;

  seq = String(seq || '').toUpperCase().replace(/[^ATGC]/g, 'A');
  const N = seq.length;
  if (N < 2) return 0;

  // ── Nearest-neighbor thermodynamics at 1 M NaCl (SantaLucia 1998) ──
  let dH = 0, dS = 0;
  for (let i = 0; i < N - 1; i++) {
    const p = NN_PARAMS[seq[i] + seq[i + 1]];
    if (p) { dH += p.dH; dS += p.dS; }
  }
  // Per-end initiation — SantaLucia 1998 unified model.
  //  terminal A·T: ΔH +2.3, ΔS +4.1
  //  terminal G·C: ΔH +0.1, ΔS −2.8
  // (Previous bug: default (0.2, -5.7) + extra (2.3, 4.1) when AT → ΔS was wrong)
  for (const end of [seq[0], seq[N - 1]]) {
    if (end === 'A' || end === 'T') { dH += 2.3; dS += 4.1; }
    else                             { dH += 0.1; dS += -2.8; }
  }

  // Tm at 1 M Na⁺ (Kelvin)
  const Tm1M_K = (dH * 1000) / (dS + R_GAS * Math.log(primer / 4));

  // ── Salt correction: Owczarzy 2004 (Na only) / Owczarzy 2008 (Na + Mg) ──
  const gcN = (seq.match(/[GC]/g) || []).length;
  const fGC = gcN / N;
  const mgFree = Math.max(0, Mg - dNTP); // dNTP chelates Mg 1:1

  let invTm;

  if (mgFree <= 0) {
    // Sodium-only: Owczarzy 2004 eq 22
    const safeNa = Math.max(Na, 1e-9);
    const lnNa = Math.log(safeNa);
    invTm = 1 / Tm1M_K
      + (4.29 * fGC - 3.95) * 1e-5 * lnNa
      + 9.40e-6 * lnNa * lnNa;
  } else {
    // Mg-present: Owczarzy 2008 eq 16 + mixed-regime corrections
    const safeNa = Math.max(Na, 1e-9);
    const lnNa = Math.log(safeNa);
    const lnMg = Math.log(mgFree);
    const Rratio = Math.sqrt(mgFree) / safeNa;

    let a = 3.92e-5;
    let b = -9.11e-6;
    let c = 6.26e-5;
    let d = 1.42e-5;
    const e = -4.82e-4;
    const f = 5.25e-4;
    let g = 8.31e-5;

    // 0.22 ≤ R < 6: mono/di mixed regime — Owczarzy 2008 correction
    if (Rratio >= 0.22 && Rratio < 6.0) {
      a = 3.92e-5 * (0.843 - 0.352 * Math.sqrt(safeNa) * lnNa);
      d = 1.42e-5 * (1.279 - 4.03e-3 * lnNa - 8.03e-3 * lnNa * lnNa);
      g = 8.31e-5 * (0.486 - 0.258 * lnNa + 5.25e-3 * lnNa * lnNa * lnNa);
    }
    // R < 0.22 — monovalent dominates (drop to Owczarzy 2004 formula)
    if (Rratio < 0.22) {
      invTm = 1 / Tm1M_K
        + (4.29 * fGC - 3.95) * 1e-5 * lnNa
        + 9.40e-6 * lnNa * lnNa;
    } else {
      invTm = 1 / Tm1M_K
        + a
        + b * lnMg
        + fGC * (c + d * lnMg)
        + (1 / (2 * (N - 1))) * (e + f * lnMg + g * lnMg * lnMg);
    }
  }

  const tmC = 1 / invTm - 273.15;
  return Math.round(tmC * 10) / 10;
}

export function gcContent(seq) {
  const gc = (seq.match(/[GC]/gi) || []).length;
  return Math.round((gc / seq.length) * 100);
}

const RC_MAP = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' };
export function revComp(seq) {
  return seq.toUpperCase().split('').reverse().map(b => RC_MAP[b] || 'N').join('');
}

// ─── QC checks ───────────────────────────────────────────────────────────────
function hasDinucRepeat(seq) {
  return /([ATGC]{2})\1{3,}/.test(seq);
}
function hasHomopolymer(seq, n = 5) {
  return new RegExp(`([ATGC])\\1{${n - 1},}`).test(seq);
}

// 3' GC clamp: 1–3 G/C within the last 5 bp; no ≥3 consecutive G/C
function check3GCClamp(seq) {
  const tail = seq.slice(-5);
  const gcCount = (tail.match(/[GC]/g) || []).length;
  if (gcCount < 1 || gcCount > 3) return false;
  if (/[GC]{3,}/.test(tail)) return false;
  return true;
}

// Hairpin check: look for ≥4 bp stem (simple)
export function hasHairpin(seq, minStem = 4) {
  seq = seq.toUpperCase();
  for (let i = 0; i < seq.length - minStem * 2 - 3; i++) {
    const stem1 = seq.slice(i, i + minStem);
    const rc = revComp(stem1);
    const searchFrom = i + minStem + 3;
    if (seq.slice(searchFrom).includes(rc)) return true;
  }
  return false;
}

// Self-dimer: check whether the 3' 4 bp complements itself
export function hasSelfDimer(seq, minOverlap = 4) {
  seq = seq.toUpperCase();
  const rc = revComp(seq);
  const tail = seq.slice(-minOverlap);
  return rc.includes(tail);
}

// Cross-dimer: check whether the 3' ends of two primers complement each other
export function hasCrossDimer(seq1, seq2, minOverlap = 4) {
  const tail1 = seq1.slice(-minOverlap).toUpperCase();
  const tail2 = seq2.slice(-minOverlap).toUpperCase();
  return revComp(tail1) === tail2 || revComp(tail2) === tail1 ||
    seq2.toUpperCase().includes(revComp(tail1)) ||
    seq1.toUpperCase().includes(revComp(tail2));
}

// ─── Neighboring-variant masking ────────────────────────────────────────────
/**
 * Return a sequence with SNP/InDel positions masked as N, based on positionData
 * @param {string} refSeq     - full region reference sequence (1-based local coord)
 * @param {Array}  positionData - precomputed positionData
 * @param {number} excludePos - target SNP position to exclude from masking
 */
export function maskVariants(refSeq, positionData, excludePos = null) {
  const arr = refSeq.toUpperCase().split('');
  if (!positionData) return arr.join('');
  for (const pd of positionData) {
    if (pd.pos === excludePos) continue;
    if (pd.hasSnp || pd.hasDel || pd.hasIns) {
      const idx = pd.pos - 1;
      if (idx >= 0 && idx < arr.length) arr[idx] = 'N';
    }
  }
  return arr.join('');
}

// ─── Primer scoring ───────────────────────────────────────────────────────────
function scorePrimer(seq, opts = {}) {
  const { targetTm = 63, isASP = false } = opts;
  const tm = calcTm(seq);
  const gc = gcContent(seq);
  const len = seq.length;
  let score = 100;
  score -= Math.abs(tm - targetTm) * 4;   // Tm: ideal 63°C
  score -= Math.abs(gc - 50) * 0.5;
  score -= Math.abs(len - 22) * 1;        // length: ideal 22bp
  if (check3GCClamp(seq)) score += 8;
  if (hasDinucRepeat(seq)) score -= 20;
  if (hasHomopolymer(seq)) score -= 15;
  if (hasHairpin(seq)) score -= 25;
  if (hasSelfDimer(seq)) score -= 20;
  return score;
}

// ─── KASP marker design ───────────────────────────────────────────────────────
/**
 * @param {string} refSeq       - full region reference sequence (1-based local coord)
 * @param {number} snpPos       - SNP local coordinate (1-based)
 * @param {string} allele1      - Allele 1 (ref allele)
 * @param {string} allele2      - Allele 2 (alt allele)
 * @param {string} strand       - '+' | '-'
 * @param {Array}  positionData - for neighboring-variant masking
 * @param {object} opts
 */
export function designKASP(refSeq, snpPos, allele1, allele2, strand = '+', positionData = null, opts = {}) {
  const {
    minAmplicon = 50,
    maxAmplicon = 150,
    aspMinLen = 21,
    aspMaxLen = 25,
    cpMinLen = 20,
    cpMaxLen = 30,
    tmMin = 62,
    tmMax = 65,
    gcMin = 40,
    gcMax = 60,
    aspTmDiffMax = 0.5,
    aspCpTmDiffMax = 3,
    hairpinMinStem = 4,    // minimum stem length for hairpin detection
    dimerMinOverlap = 4,   // minimum overlap for self/cross-dimer detection
    autoAdjust = false,
    maskNeighbors = false, // when true, replace neighboring SNP/InDel positions with 'N'
                           // to force primer candidates to avoid them entirely.
                           // Drastically reduces candidate count but produces
                           // variant-free, robust primers.
    sampleList = null,     // array of sample IDs (for diagnostic info)
    sampleMeta = null,     // { [sampleId]: { variety, ... } } (optional)
  } = opts;

  // Sequence used for primer search.
  // - maskNeighbors=false (default): use ref as-is; nearby variants surface as warnings only
  // - maskNeighbors=true: mask other SNP/InDel positions with 'N'; primer candidates
  //   containing 'N' are filtered out by the existing `primerSeq.includes('N')` check
  const seq = (maskNeighbors && positionData)
    ? maskVariants(refSeq, positionData, snpPos).toUpperCase()
    : refSeq.toUpperCase();
  const snpIdx = snpPos - 1;

  if (snpIdx < 0 || snpIdx >= seq.length) return { error: 'Invalid SNP position.' };
  if (!allele1 || !allele2 || allele1 === allele2) return { error: 'Allele1 and Allele2 must be different.' };

  const COMP = { A:'T', T:'A', G:'C', C:'G', N:'N' };
  const effA1 = strand === '-' ? (COMP[allele1.toUpperCase()] || allele1) : allele1;
  const effA2 = strand === '-' ? (COMP[allele2.toUpperCase()] || allele2) : allele2;

  const windowSeq = seq.slice(Math.max(0, snpIdx - 30), snpIdx + 30);
  const localGC = gcContent(windowSeq);
  const localTm = calcTm(seq.slice(Math.max(0, snpIdx - 22), snpIdx) + allele1);

  // ── Collect "blocking variants" — neighbor SNPs/InDels in primer regions ──
  // Used in the error diagnostic when maskNeighbors blocks all candidates,
  // and as a warning when nearby variants exist even without masking.
  const collectBlockingVariants = (regionStart, regionEnd) => {
    if (!positionData) return [];
    const blockers = [];
    for (const pd of positionData) {
      if (pd.pos === snpPos) continue;
      if (pd.pos < regionStart || pd.pos > regionEnd) continue;
      if (!pd.hasSnp && !pd.hasDel && !pd.hasIns) continue;

      // Sample IDs carrying this variant
      const carrierIds = [];
      if (sampleList && pd.enc) {
        for (let si = 0; si < sampleList.length; si++) {
          if (pd.enc[si] && pd.enc[si] !== '0') carrierIds.push(sampleList[si]);
        }
      }
      // Map to varieties (use sample ID as fallback when variety unknown)
      const varieties = sampleMeta
        ? carrierIds.map(s => sampleMeta[s]?.variety || s)
        : carrierIds;

      let kind = 'SNP', altDesc = pd.alt?.join('/') || '?';
      if (pd.hasIns) {
        kind = 'InDel';
        const insSeq = pd.alt?.[0]?.split('+')[1] || '';
        altDesc = '+' + insSeq.length + 'bp';
      } else if (pd.hasDel) {
        kind = 'InDel';
        altDesc = '-1bp';
      } else {
        altDesc = (pd.ref || '?') + '→' + altDesc;
      }
      blockers.push({
        pos: pd.pos,
        kind,
        altDesc,
        nSamples: carrierIds.length,
        varieties,
      });
    }
    return blockers.sort((a, b) => b.nSamples - a.nSamples);
  };
  // ASP region spans roughly [snpPos - aspMaxLen + 1, snpPos]
  // (extend a bit for CP region too, but ASP is the strict one)
  const aspRegionStart = snpPos - aspMaxLen + 1;
  const aspRegionEnd = snpPos;

  // Reference sequence of the ASP region (for visualization in error messages).
  // Use the unmasked refSeq so the user sees actual bases; variants are highlighted separately.
  const aspRegionRefSeq = (() => {
    const startIdx = Math.max(0, aspRegionStart - 1);
    const endIdx = Math.min(refSeq.length, aspRegionEnd);
    return refSeq.slice(startIdx, endIdx).toUpperCase();
  })();
  const aspRegionInfo = {
    refSeq: aspRegionRefSeq,
    startPos: aspRegionStart,  // 1-based local
    endPos: aspRegionEnd,      // 1-based local
    snpPos,
  };

  let effTmMin = tmMin, effTmMax = tmMax, effGcMin = gcMin, effGcMax = gcMax;
  let wasAutoAdjusted = false;

  // Allele-Specific Primers (ASP): 3' end = SNP base
  const aspResults = { a1: [], a2: [] };
  const aspDiag = { a1: { tmFail:0, gcFail:0, hpFail:0, masked:0, candidates:[] },
                    a2: { tmFail:0, gcFail:0, hpFail:0, masked:0, candidates:[] } };
  for (const [key, altBase] of [['a1', effA1], ['a2', effA2]]) {
    for (let len = aspMinLen; len <= aspMaxLen; len++) {
      const start = snpIdx - len + 1;
      if (start < 0) continue;
      const primerSeq = seq.slice(start, snpIdx) + altBase;
      if (primerSeq.includes('N')) { aspDiag[key].masked++; continue; }
      const tm = calcTm(primerSeq);
      const gc = gcContent(primerSeq);
      aspDiag[key].candidates.push({ len, tm, gc });
      if (tm < effTmMin || tm > effTmMax) { aspDiag[key].tmFail++; continue; }
      if (gc < effGcMin || gc > effGcMax) { aspDiag[key].gcFail++; continue; }
      if (hasHomopolymer(primerSeq)) { aspDiag[key].hpFail++; continue; }
      aspResults[key].push({ seq: primerSeq, tm, gc, len, score: scorePrimer(primerSeq, { isASP: true }) });
    }
  }

  // On failure, produce detailed diagnostic message
  const diagMessage = (key, allele) => {
    const d = aspDiag[key];
    const tmVals = d.candidates.map(c => c.tm);
    const gcVals = d.candidates.map(c => c.gc);
    const tmRange = tmVals.length ? `${Math.min(...tmVals).toFixed(1)}–${Math.max(...tmVals).toFixed(1)}°C` : 'N/A';
    const gcRange = gcVals.length ? `${Math.min(...gcVals)}–${Math.max(...gcVals)}%` : 'N/A';
    const reasons = [];
    if (d.masked > 0) reasons.push(`${d.masked} candidates blocked by nearby variants (masked)`);
    if (d.tmFail > 0) reasons.push(`${d.tmFail} candidates failed Tm (actual range: ${tmRange}, required: ${effTmMin}–${effTmMax}°C)`);
    if (d.gcFail > 0) reasons.push(`${d.gcFail} candidates failed GC (actual range: ${gcRange}, required: ${effGcMin}–${effGcMax}%)`);
    if (d.hpFail > 0) reasons.push(`${d.hpFail} candidates had homopolymer runs`);
    const suggestion = [];
    if (d.tmFail > 0) {
      const avgTm = tmVals.reduce((a,b)=>a+b,0)/tmVals.length;
      suggestion.push(`Try Tm ${Math.round(avgTm-5)}–${Math.round(avgTm+5)}°C`);
    }
    if (d.gcFail > 0) {
      const avgGC = gcVals.reduce((a,b)=>a+b,0)/gcVals.length;
      suggestion.push(`Try GC ${Math.round(avgGC-10)}–${Math.round(avgGC+10)}%`);
    }
    if (d.masked > 0) suggestion.push('Nearby variants are masking primer sites — try a different SNP');
    return `Cannot design ${allele} ASP.\nReasons: ${reasons.join('; ')}\n` +
           `Local sequence: GC=${localGC}%, Tm≈${localTm}°C\n` +
           (suggestion.length ? `Suggestion: ${suggestion.join(', ')}` : '');
  };

  if (!aspResults.a1.length) {
    if (!autoAdjust) return {
      error: diagMessage('a1', `Allele1 (${allele1})`),
      blockingVariants: aspDiag.a1.masked > 0 ? collectBlockingVariants(aspRegionStart, aspRegionEnd) : null,
      aspRegionInfo: aspDiag.a1.masked > 0 ? aspRegionInfo : null,
    };
    // autoAdjust: expand parameters based on actual candidate Tm/GC and retry
    const allCands = [...aspDiag.a1.candidates, ...aspDiag.a2.candidates];
    if (allCands.length) {
      const tmVals = allCands.map(c => c.tm);
      const gcVals = allCands.map(c => c.gc);
      effTmMin = Math.min(effTmMin, Math.floor(Math.min(...tmVals)) - 2);
      effTmMax = Math.max(effTmMax, Math.ceil(Math.max(...tmVals)) + 2);
      effGcMin = Math.min(effGcMin, Math.floor(Math.min(...gcVals)) - 5);
      effGcMax = Math.max(effGcMax, Math.ceil(Math.max(...gcVals)) + 5);
      wasAutoAdjusted = true;
      // retry
      for (const [key, altBase] of [['a1', effA1], ['a2', effA2]]) {
        if (aspResults[key].length) continue;
        for (let len = aspMinLen; len <= aspMaxLen; len++) {
          const start = snpIdx - len + 1;
          if (start < 0) continue;
          const primerSeq = seq.slice(start, snpIdx) + altBase;
          if (primerSeq.includes('N')) continue;
          const tm = calcTm(primerSeq);
          const gc = gcContent(primerSeq);
          if (tm < effTmMin || tm > effTmMax) continue;
          if (gc < effGcMin || gc > effGcMax) continue;
          if (hasHomopolymer(primerSeq)) continue;
          aspResults[key].push({ seq: primerSeq, tm, gc, len, score: scorePrimer(primerSeq, { isASP: true }) });
        }
      }
    }
    if (!aspResults.a1.length) return {
      error: diagMessage('a1', `Allele1 (${allele1})`),
      blockingVariants: aspDiag.a1.masked > 0 ? collectBlockingVariants(aspRegionStart, aspRegionEnd) : null,
      aspRegionInfo: aspDiag.a1.masked > 0 ? aspRegionInfo : null,
    };
  }
  if (!aspResults.a2.length) {
    if (!autoAdjust) return {
      error: diagMessage('a2', `Allele2 (${allele2})`),
      blockingVariants: aspDiag.a2.masked > 0 ? collectBlockingVariants(aspRegionStart, aspRegionEnd) : null,
      aspRegionInfo: aspDiag.a2.masked > 0 ? aspRegionInfo : null,
    };
    if (!aspResults.a2.length) return {
      error: diagMessage('a2', `Allele2 (${allele2})`),
      blockingVariants: aspDiag.a2.masked > 0 ? collectBlockingVariants(aspRegionStart, aspRegionEnd) : null,
      aspRegionInfo: aspDiag.a2.masked > 0 ? aspRegionInfo : null,
    };
  }

  // Common Primer (CP): opposite orientation of ASP, amplicon 50–150 bp
  const cpResults = [];
  const searchEnd = Math.min(snpIdx + maxAmplicon, seq.length);
  for (let end = snpIdx + minAmplicon; end <= searchEnd; end++) {
    for (let len = cpMinLen; len <= cpMaxLen; len++) {
      const start = end - len;
      if (start <= snpIdx) continue;
      const segment = seq.slice(start, end);
      if (segment.includes('N')) continue;
      const rc = revComp(segment);
      const tm = calcTm(rc);
      const gc = gcContent(rc);
      if (tm < effTmMin || tm > effTmMax) continue;
      if (gc < effGcMin || gc > effGcMax) continue;
      if (hasHomopolymer(rc)) continue;
      const ampliconSize = end - snpIdx;
      cpResults.push({ seq: rc, tm, gc, len, ampliconSize,
        score: scorePrimer(rc) + (ampliconSize >= minAmplicon && ampliconSize <= maxAmplicon ? 10 : -10) });
    }
  }

  if (!cpResults.length) {
    const cpTmVals = [], cpGcVals = [];
    const end0 = Math.min(snpIdx + maxAmplicon, seq.length);
    for (let end = snpIdx + minAmplicon; end <= end0; end++) {
      for (let len = cpMinLen; len <= cpMaxLen; len++) {
        const start = end - len; if (start <= snpIdx) continue;
        const seg = seq.slice(start, end); if (seg.includes('N')) continue;
        const rc = revComp(seg);
        cpTmVals.push(calcTm(rc)); cpGcVals.push(gcContent(rc));
      }
    }
    const tmR = cpTmVals.length ? `${Math.min(...cpTmVals).toFixed(1)}–${Math.max(...cpTmVals).toFixed(1)}°C` : 'N/A';
    const gcR = cpGcVals.length ? `${Math.min(...cpGcVals)}–${Math.max(...cpGcVals)}%` : 'N/A';
    const avgTm = cpTmVals.length ? cpTmVals.reduce((a,b)=>a+b,0)/cpTmVals.length : 0;
    const avgGC = cpGcVals.length ? cpGcVals.reduce((a,b)=>a+b,0)/cpGcVals.length : 0;
    return { error: `Cannot design Common Primer.\nDownstream region Tm: ${tmR}, GC: ${gcR}\nRequired: Tm ${effTmMin}–${effTmMax}°C, GC ${effGcMin}–${effGcMax}%, amplicon ${minAmplicon}–${maxAmplicon}bp\nSuggestion: Try Tm ${Math.round(avgTm-6)}–${Math.round(avgTm+6)}°C, GC ${Math.round(avgGC-12)}–${Math.round(avgGC+12)}%, or increase Max amplicon` };
  }

  const adjustNote = wasAutoAdjusted
    ? `Auto-adjusted params: Tm ${effTmMin}–${effTmMax}°C, GC ${effGcMin}–${effGcMax}% (local GC ${localGC}%, Tm≈${localTm}°C)`
    : `Params: Tm ${effTmMin}–${effTmMax}°C, GC ${effGcMin}–${effGcMax}%`;
  let best = null, bestScore = -Infinity;
  const topA1 = aspResults.a1.sort((a, b) => b.score - a.score).slice(0, 5);
  const topA2 = aspResults.a2.sort((a, b) => b.score - a.score).slice(0, 5);
  const topCP = cpResults.sort((a, b) => b.score - a.score).slice(0, 10);

  for (const a1 of topA1) {
    for (const a2 of topA2) {
      const aspTmDiff = Math.abs(a1.tm - a2.tm);
      if (aspTmDiff > aspTmDiffMax) continue;
      const aspAvgTm = (a1.tm + a2.tm) / 2;
      for (const cp of topCP) {
        if (hasCrossDimer(a1.seq, cp.seq, dimerMinOverlap)) continue;
        if (hasCrossDimer(a2.seq, cp.seq, dimerMinOverlap)) continue;
        if (hasCrossDimer(a1.seq, a2.seq, dimerMinOverlap)) continue;
        const aspCpDiff = Math.abs(aspAvgTm - cp.tm);
        if (aspCpDiff > aspCpTmDiffMax) continue; // ASP/CP Tm-diff criterion
        const score = a1.score + a2.score + cp.score - aspTmDiff * 5 - aspCpDiff;
        if (score > bestScore) { bestScore = score; best = { a1, a2, cp }; }
      }
    }
  }

  // fallback: relax cross-dimer constraint
  if (!best) {
    for (const a1 of topA1) {
      for (const a2 of topA2) {
        const aspTmDiff = Math.abs(a1.tm - a2.tm);
        if (aspTmDiff > aspTmDiffMax) continue;
        const aspAvgTm = (a1.tm + a2.tm) / 2;
        for (const cp of topCP) {
          const aspCpDiff = Math.abs(aspAvgTm - cp.tm);
          if (aspCpDiff > aspCpTmDiffMax) continue;
          if (hasCrossDimer(a1.seq, cp.seq, dimerMinOverlap)) continue;
          if (hasCrossDimer(a2.seq, cp.seq, dimerMinOverlap)) continue;
          const score = a1.score + a2.score + cp.score - aspTmDiff * 5 - aspCpDiff;
          if (score > bestScore) { bestScore = score; best = { a1, a2, cp }; }
        }
      }
    }
  }

  if (!best) {
    const aspTms = [...aspResults.a1, ...aspResults.a2].map(p => p.tm);
    const cpTms = cpResults.map(p => p.tm);
    const aspR = aspTms.length ? (Math.min(...aspTms).toFixed(1) + '-' + Math.max(...aspTms).toFixed(1) + 'C') : 'N/A';
    const cpR = cpTms.length ? (Math.min(...cpTms).toFixed(1) + '-' + Math.max(...cpTms).toFixed(1) + 'C') : 'N/A';
    return { error: 'Cannot find valid primer combination.\nASP Tm: ' + aspR + ', CP Tm: ' + cpR + '\nSuggestion: Increase ASP Tm diff or ASP/CP Tm diff max in Design Options.' };
  }

  return {
    type: 'KASP',
    snpPos,
    allele1, allele2,
    primers: {
      allele1: { seq: best.a1.seq, fullSeq: FAM_TAIL + best.a1.seq, tm: best.a1.tm, gc: best.a1.gc, len: best.a1.len, tail: 'FAM' },
      allele2: { seq: best.a2.seq, fullSeq: HEX_TAIL + best.a2.seq, tm: best.a2.tm, gc: best.a2.gc, len: best.a2.len, tail: 'HEX' },
      common:  { seq: best.cp.seq, fullSeq: best.cp.seq, tm: best.cp.tm, gc: best.cp.gc, len: best.cp.len, ampliconSize: best.cp.ampliconSize },
    },
    ampliconSize: best.cp.ampliconSize,
    tmDiff: Math.abs(best.a1.tm - best.a2.tm),
    qc: {
      hairpinA1: hasHairpin(best.a1.seq, hairpinMinStem),
      hairpinA2: hasHairpin(best.a2.seq, hairpinMinStem),
      hairpinCP: hasHairpin(best.cp.seq, hairpinMinStem),
      selfDimerA1: hasSelfDimer(best.a1.seq, dimerMinOverlap),
      selfDimerA2: hasSelfDimer(best.a2.seq, dimerMinOverlap),
      crossDimer: hasCrossDimer(best.a1.seq, best.a2.seq, dimerMinOverlap) || hasCrossDimer(best.a1.seq, best.cp.seq, dimerMinOverlap) || hasCrossDimer(best.a2.seq, best.cp.seq, dimerMinOverlap),
      // Check for other SNPs at primer-binding position (warning-only since we designed without masking)
      variantsMasked: positionData ? positionData.filter(pd =>
        pd.pos !== snpPos && pd.hasSnp &&
        pd.pos >= snpIdx - aspMaxLen + 1 && pd.pos <= best.cp.seq.length + snpIdx
      ).length : 0,
    },
    note: `SNP pos ${snpPos}: ref=${allele1} / alt=${allele2} | amplicon ${best.cp.ampliconSize}bp | ASP Tm diff ${Math.abs(best.a1.tm - best.a2.tm).toFixed(1)}°C | ${adjustNote}`,
  };
}

// ─── InDel marker design ──────────────────────────────────────────────────────
/**
 * Design F/R primers based on dragRange
 * @param {string} refSeq
 * @param {number} rangeStart  - start of drag range (1-based local)
 * @param {number} rangeEnd    - end of drag range (1-based local)
 * @param {Array}  positionData
 * @param {object} opts
 */
export function designInDel(refSeq, rangeStart, rangeEnd, positionData = null, opts = {}) {
  const {
    primerMinLen = 18, primerMaxLen = 25,
    tmMin = 55, tmMax = 65,
    gcMin = 40, gcMax = 60,
    minAmplicon = 100, maxAmplicon = 300,
    autoAdjust = false,
    tmDiffMax = 2,
    hairpinMinStem = 4,
    dimerMinOverlap = 4,   // max F/R Tm diff (recommended 1, max 2)
  } = opts;

  // Mask SNPs only (do not mask InDel/Gap)
  const arr = refSeq.toUpperCase().split('');
  if (positionData) {
    for (const pd of positionData) {
      if (pd.hasSnp) {
        const idx = pd.pos - 1;
        if (idx >= 0 && idx < arr.length) arr[idx] = 'N';
      }
    }
  }
  const seq = arr.join('');

  const rStart = rangeStart - 1; // 0-based
  const rEnd   = rangeEnd - 1;   // 0-based inclusive

  // Space check
  if (rStart < primerMinLen) {
    return { error: `Not enough upstream sequence for Forward primer (need ≥${primerMinLen}bp before range start).
Suggestion: Select a range further from the sequence start.` };
  }
  if (seq.length - rEnd < primerMinLen + 1) {
    return { error: `Not enough downstream sequence for Reverse primer.
Suggestion: Select a range further from the sequence end.` };
  }

  // Search function: take range and Tm/GC params, return candidates
  const searchFwd = (searchDist, effTmMin, effTmMax, effGcMin, effGcMax) => {
    const results = [];
    for (let end = rStart; end >= Math.max(0, rStart - searchDist); end--) {
      for (let len = primerMinLen; len <= primerMaxLen; len++) {
        const start = end - len;
        if (start < 0) continue;
        const ps = seq.slice(start, end);
        if (ps.includes('N')) continue;
        const tm = calcTm(ps), gc = gcContent(ps);
        if (tm < effTmMin || tm > effTmMax) continue;
        if (gc < effGcMin || gc > effGcMax) continue;
        if (hasHomopolymer(ps)) continue;
        results.push({ seq: ps, tm, gc, len, endPos: end, score: scorePrimer(ps) });
      }
    }
    return results;
  };
  const searchRev = (searchDist, effTmMin, effTmMax, effGcMin, effGcMax) => {
    const results = [];
    for (let start = rEnd + 1; start <= Math.min(seq.length - primerMinLen, rEnd + searchDist); start++) {
      for (let len = primerMinLen; len <= primerMaxLen; len++) {
        const end = start + len;
        if (end > seq.length) continue;
        const seg = seq.slice(start, end);
        if (seg.includes('N')) continue;
        const rc = revComp(seg);
        const tm = calcTm(rc), gc = gcContent(rc);
        if (tm < effTmMin || tm > effTmMax) continue;
        if (gc < effGcMin || gc > effGcMax) continue;
        if (hasHomopolymer(rc)) continue;
        results.push({ seq: rc, tm, gc, len, startPos: start, score: scorePrimer(rc) });
      }
    }
    return results;
  };

  // Staged search: 1) defaults → 2) widen Tm/GC → 3) widen amplicon distance
  let fwdResults = [], revResults = [];
  let wasAutoAdjusted = false;
  let effTmMin = tmMin, effTmMax = tmMax, effGcMin = gcMin, effGcMax = gcMax;

  // Step 1: default parameters, 150 bp
  fwdResults = searchFwd(maxAmplicon, effTmMin, effTmMax, effGcMin, effGcMax);
  revResults = searchRev(maxAmplicon, effTmMin, effTmMax, effGcMin, effGcMax);

  // Step 2: auto-widen Tm/GC (if autoAdjust or no candidates)
  if (!fwdResults.length || !revResults.length) {
    // Collect candidates without limits to understand the actual distribution
    const probeFwd = searchFwd(maxAmplicon + 50, 35, 80, 10, 90);
    const probeRev = searchRev(maxAmplicon + 50, 35, 80, 10, 90);
    const allProbe = [...probeFwd, ...probeRev];
    if (allProbe.length) {
      const tmVals = allProbe.map(c => c.tm);
      const gcVals = allProbe.map(c => c.gc);
      effTmMin = Math.floor(Math.min(...tmVals)) - 2;
      effTmMax = Math.ceil(Math.max(...tmVals)) + 2;
      effGcMin = Math.max(10, Math.floor(Math.min(...gcVals)) - 5);
      effGcMax = Math.min(90, Math.ceil(Math.max(...gcVals)) + 5);
      fwdResults = searchFwd(maxAmplicon, effTmMin, effTmMax, effGcMin, effGcMax);
      revResults = searchRev(maxAmplicon, effTmMin, effTmMax, effGcMin, effGcMax);
      wasAutoAdjusted = true;
    }
  }

  // Step 3: gradually widen amplicon distance (150 → 300 → 500 → 800)
  if (!fwdResults.length || !revResults.length) {
    for (const dist of [maxAmplicon * 2, maxAmplicon * 3, maxAmplicon * 5]) {
      if (!fwdResults.length) fwdResults = searchFwd(dist, effTmMin, effTmMax, effGcMin, effGcMax);
      if (!revResults.length) revResults = searchRev(dist, effTmMin, effTmMax, effGcMin, effGcMax);
      if (fwdResults.length && revResults.length) { wasAutoAdjusted = true; break; }
    }
  }

  // If autoAdjust is off but auto-adjustment happened, discard results and return an error
  if (!autoAdjust && wasAutoAdjusted) {
    fwdResults.length = 0;
    revResults.length = 0;
  }

  if (!fwdResults.length || !revResults.length) {
    const side = !fwdResults.length ? 'Forward' : 'Reverse';
    const allCands = [...fwdResults, ...revResults];
    const tmVals = allCands.map(c => c.tm);
    const gcVals = allCands.map(c => c.gc);
    const tmHint = tmVals.length ? `actual Tm: ${Math.min(...tmVals).toFixed(1)}–${Math.max(...tmVals).toFixed(1)}°C` : '';
    const gcHint = gcVals.length ? `actual GC: ${Math.min(...gcVals)}–${Math.max(...gcVals)}%` : '';
    return { error: `Cannot design ${side} primer.\n${[tmHint, gcHint].filter(Boolean).join(', ')}\nSuggestion: ${autoAdjust ? 'Try a wider drag range or adjust options.' : 'Enable Auto-adjust or expand Tm/GC range.'}` };
  }

  // Optimal combination: covers drag range + Tm diff + cross-dimer
  // No forced amplicon size — OK as long as Fwd is left of rangeStart and Rev is right of rangeEnd
  const refAmpliconSize = rEnd - rStart + 1;
  let best = null, bestScore = -Infinity;
  for (const f of fwdResults.sort((a,b)=>b.score-a.score).slice(0,50)) {
    for (const r of revResults.sort((a,b)=>b.score-a.score).slice(0,50)) {
      const ampliconSize = r.startPos + r.len - f.endPos;
      if (ampliconSize < 50) continue; // minimum 50 bp
      if (hasCrossDimer(f.seq, r.seq, dimerMinOverlap)) continue;
      const tmDiff = Math.abs(f.tm - r.tm);
      if (tmDiff > tmDiffMax) continue;
      const score = f.score + r.score - tmDiff * 3;
      if (score > bestScore) { bestScore = score; best = { fwd: f, rev: r, ampliconSize, tmDiff }; }
    }
  }
  // fallback: relax cross-dimer constraint
  if (!best) {
    for (const f of fwdResults.slice(0,50)) {
      for (const r of revResults.slice(0,50)) {
        const ampliconSize = r.startPos + r.len - f.endPos;
        if (ampliconSize < 50) continue;
        const tmDiff = Math.abs(f.tm - r.tm);
        if (tmDiff > tmDiffMax) continue;
        const score = f.score + r.score - tmDiff * 2;
        if (score > bestScore) { bestScore = score; best = { fwd: f, rev: r, ampliconSize, tmDiff }; }
      }
    }
  }
  if (!best) {
    const fTm = fwdResults[0]?.tm.toFixed(1) ?? '?';
    const rTm = revResults[0]?.tm.toFixed(1) ?? '?';
    const minDiff = fwdResults.length && revResults.length
      ? Math.min(...fwdResults.slice(0,20).flatMap(f => revResults.slice(0,20).map(r => Math.abs(f.tm-r.tm)))).toFixed(1)
      : '?';
    return { error: `No primer pair found within Tm diff ≤${tmDiffMax}°C.
Fwd Tm ~${fTm}°C, Rev Tm ~${rTm}°C (min diff: ${minDiff}°C)
Suggestion: Increase F/R Tm Diff max in options, or try a different range.` };
  }

  // Check whether there are SNPs at primer positions within the amplicon
  const primerSnps = positionData
    ? positionData.filter(pd => pd.hasSnp &&
        ((pd.pos >= best.fwd.endPos - best.fwd.len + 1 && pd.pos <= best.fwd.endPos) ||
         (pd.pos >= best.rev.startPos && pd.pos <= best.rev.startPos + best.rev.len)))
    : [];

  // Whether PAGE is recommended (min InDel size within range)
  const rangeIndels = positionData
    ? positionData.filter(pd => pd.pos >= rangeStart && pd.pos <= rangeEnd && (pd.hasDel || pd.hasIns || pd.hasNoCov))
    : [];
  const minIndelSize = rangeIndels.length > 0 ? 1 : 0; // can be improved with actual size later
  const needsPage = rangeIndels.some(pd => pd.hasIns && pd.alt?.[0]?.includes('+') && pd.alt[0].split('+')[1]?.length < 10);

  return {
    type: 'InDel',
    rangeStart, rangeEnd,
    refAmpliconSize,
    primers: {
      forward: { seq: best.fwd.seq, tm: best.fwd.tm, gc: best.fwd.gc, len: best.fwd.len, endPos: best.fwd.endPos },
      reverse: { seq: best.rev.seq, tm: best.rev.tm, gc: best.rev.gc, len: best.rev.len, startPos: best.rev.startPos },
    },
    ampliconSize: best.ampliconSize,
    tmDiff: best.tmDiff,
    needsPage,
    primerSnps: primerSnps.length,
    rangeIndels: rangeIndels.length,
    wasAutoAdjusted,
    qc: {
      hairpinFwd: hasHairpin(best.fwd.seq, hairpinMinStem),
      hairpinRev: hasHairpin(best.rev.seq, hairpinMinStem),
      selfDimerFwd: hasSelfDimer(best.fwd.seq, dimerMinOverlap),
      selfDimerRev: hasSelfDimer(best.rev.seq, dimerMinOverlap),
      crossDimer: hasCrossDimer(best.fwd.seq, best.rev.seq, dimerMinOverlap),
    },
    note: `Ref amplicon: ${best.ampliconSize}bp | Tm diff: ${best.tmDiff.toFixed(1)}°C${wasAutoAdjusted ? ' | ⚡ Auto-adjusted' : ''}${primerSnps.length > 0 ? ` | ⚠ ${primerSnps.length} SNP(s) in primer region` : ''}`,
  };
}
