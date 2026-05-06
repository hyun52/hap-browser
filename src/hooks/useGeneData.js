import { useState, useCallback, useRef } from 'react';
import { parseFASTA, parseGFF3 } from '../utils/parsers.js';

export function useGeneData() {
  const [index, setIndex] = useState(null);
  const [gene, setGene] = useState(null);
  const [samples, setSamples] = useState([]);
  const [hapCombos, setHapCombos] = useState(null);
  const [classifyFlags, setClassifyFlags] = useState({ snp: true, indel: true, gap: true });
  const [loading, setLoading] = useState('');
  const [pileupProgress, setPileupProgress] = useState(0);

  const geneCache = useRef({});
  const precomputedCache = useRef({});
  const pileupCache = useRef({});  // Actual pileup data (with depth)
  const abortRef = useRef(null);

  const getHapData = useCallback((target, flags) => {
    if (!hapCombos) return null;
    const key = `${target}_${flags.snp ? 1 : 0}${flags.indel ? 1 : 0}${flags.gap ? 1 : 0}`;
    return hapCombos[key] || null;
  }, [hapCombos]);

  const loadIndex = useCallback(async () => {
    setLoading('Loading gene index…');
    try {
      const res = await fetch('data/index.json?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('data/index.json not found');
      const data = await res.json();
      setIndex(data); setLoading(''); return data;
    } catch (err) { setLoading(`Error: ${err.message}`); return null; }
  }, []);

  const loadGene = useCallback(async (geneInfo) => {
    const id = geneInfo.id;
    if (geneCache.current[id]) { setGene(geneCache.current[id]); return geneCache.current[id]; }
    setLoading(`Loading ${geneInfo.sym}…`);
    try {
      const [faRes, gffRes] = await Promise.all([fetch(geneInfo.fa), fetch(geneInfo.gff)]);
      if (!faRes.ok) throw new Error('FA not found');
      if (!gffRes.ok) throw new Error('GFF not found');
      const [faText, gffText] = await Promise.all([faRes.text(), gffRes.text()]);
      const g = {
        id: geneInfo.id, sym: geneInfo.sym, desc: geneInfo.desc || '',
        chr: geneInfo.chr, strand: geneInfo.strand,
        gene_start: geneInfo.gene_start, gene_end: geneInfo.gene_end,
        region_start: geneInfo.region_start, region_end: geneInfo.region_end,
        region_length: geneInfo.region_length, offset: geneInfo.offset,
        seq: parseFASTA(faText), features: parseGFF3(gffText),
      };
      geneCache.current[id] = g; setGene(g); setLoading(''); return g;
    } catch (err) { setLoading(`Error: ${err.message}`); return null; }
  }, []);

  const loadSamples = useCallback(async (geneId) => {
    try {
      const r = await fetch(`data/bam/${geneId}/samples.json`);
      if (r.ok) { const list = await r.json(); setSamples(list); return list; }
    } catch {}
    setSamples([]); return [];
  }, []);

  // ── Load precomputed.json ─────────────────────────────────────────────────
  const loadPrecomputed = useCallback(async (geneId, _sampleList, _geneObj) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setHapCombos(null); setPileupProgress(0);

    if (precomputedCache.current[geneId]) {
      if (!controller.signal.aborted) {
        const cached = precomputedCache.current[geneId];
    setHapCombos(cached.combos);
    setGene(g => g ? { ...g, cdsSeq: cached.cdsSeq||'', cdsMap: cached.cdsMap||{} } : g);
        setPileupProgress(1);
      }
      return;
    }

    setLoading(`Loading ${geneId}…`);
    try {
      const res = await fetch(`data/precomputed/${geneId}.json`, { signal: controller.signal });
      if (!res.ok) {
        setLoading(`⚠ precomputed/${geneId}.json not found — run scripts/precompute.py`);
        return;
      }
      const pc = await res.json();
      if (controller.signal.aborted) return;

      // positionData: convert enc schema → JS-friendly form (add sample-index map)
      const sampleList = pc.samples || [];
      const sampleIdxMap = {};
      sampleList.forEach((sid, i) => { sampleIdxMap[sid] = i; });

      // flag bitfield → add bool fields (in-place mutation avoids allocating new objects)
      // pd is a JSON.parse result, so safely mutable
      const rawPositionData = pc.positionData || [];
      for (let i = 0; i < rawPositionData.length; i++) {
        const pd = rawPositionData[i];
        const f = pd.f;
        pd.hasSnp   = !!(f & 1);
        pd.hasDel   = !!(f & 2);
        pd.hasNoCov = !!(f & 4);
        pd.hasIns   = !!(f & 8);
        pd.inGene   = !!(f & 16);
        pd.inCds    = !!(f & 32);
      }
      const positionData = rawPositionData;

      const combos = { ...pc.combos, _regionPositionData: positionData };

      const cdsSeq = pc.cdsSeq || '';
      const cdsMap = pc.cdsMap || {};
      precomputedCache.current[geneId] = {
        combos, positionData,
        msaInsData: pc.msaInsData || {},
        samples: sampleList,
        sampleIdxMap,
        cdsSeq, cdsMap,
      };
      setHapCombos(combos); setPileupProgress(0.5); setLoading('');
      // Inject cdsSeq/cdsMap into the gene object synchronously
      setGene(g => g ? { ...g, cdsSeq, cdsMap } : g);

      // ── Load actual pileup (for depth/counts) ────────────────────────
      // Try all.json first; fall back to per-sample files
      let pileupLoaded = false;
      try {
        const pr = await fetch(`data/pileup/${geneId}/all.json`, { signal: controller.signal });
        if (pr.ok) {
          const merged = await pr.json();
          for (const sid of sampleList) {
            pileupCache.current[`${geneId}/${sid}`] = merged[sid] || null;
          }
          pileupLoaded = true;
          if (!controller.signal.aborted) setPileupProgress(1);
        }
      } catch {}

      if (!pileupLoaded) {
        // Load individual files (background, batched)
        const BATCH = 32;
        for (let i = 0; i < sampleList.length; i += BATCH) {
          if (controller.signal.aborted) return;
          const batch = sampleList.slice(i, i + BATCH);
          await Promise.all(batch.map(async (sid) => {
            const key = `${geneId}/${sid}`;
            if (pileupCache.current[key] !== undefined) return;
            try {
              const r = await fetch(`data/pileup/${geneId}/${sid}.json`, { signal: controller.signal });
              if (!r.ok) { pileupCache.current[key] = null; return; }
              const data = await r.json();
              pileupCache.current[key] = data.pileup || data;
            } catch { pileupCache.current[key] = null; }
          }));
          if (!controller.signal.aborted)
            setPileupProgress(0.5 + 0.5 * Math.min((i + BATCH) / sampleList.length, 1));
        }
      }
      if (!controller.signal.aborted) setPileupProgress(1);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setLoading(`Error: ${err.message}`);
    }
  }, []);

  const getPositionData = useCallback((geneId) => {
    return precomputedCache.current[geneId]?.positionData || null;
  }, []);

  const getMsaInsData = useCallback((geneId) => {
    return precomputedCache.current[geneId]?.msaInsData || {};
  }, []);

  // ── getPileup: actual pileup first; fallback → enc pseudo-pileup ───────
  const getPileup = useCallback((geneId, sampleId) => {
    // 1. Prefer data from the real pileup file (accurate depth/counts)
    const realPileup = pileupCache.current[`${geneId}/${sampleId}`];
    if (realPileup) return realPileup;

    // 2. Fallback: enc schema → pseudo-pileup
    const cache = precomputedCache.current[geneId];
    if (!cache) return null;
    const { positionData, sampleIdxMap } = cache;
    const si = sampleIdxMap[sampleId];
    if (si === undefined) return null;

    const pileup = {};
    const D = 10;

    for (const pd of positionData) {
      const enc = pd.enc || '';
      if (si >= enc.length) continue;
      const ch = enc[si];
      const base = { A: 0, T: 0, G: 0, C: 0, del: 0, ins: 0 };

      if (ch === '-') {
        pileup[String(pd.pos)] = base; // no coverage
        continue;
      }
      if (ch === '0') {
        // ref: assign depth D to the ref base
        if (pd.ref && 'ATGC'.includes(pd.ref)) base[pd.ref] = D;
        pileup[String(pd.pos)] = base;
        continue;
      }
      // alt allele
      const altIdx = parseInt(ch) - 1;
      const allele = (pd.alt || [])[altIdx] || pd.ref;
      if (allele === 'D') { base.del = D; }
      else if (allele.includes('+')) {
        const [dom, insSeq] = allele.split('+');
        if ('ATGC'.includes(dom)) base[dom] = D;
        base.ins = D; base.ins_seqs = { [insSeq]: D };
      } else if ('ATGC'.includes(allele)) { base[allele] = D; }
      else if (pd.ref && 'ATGC'.includes(pd.ref)) { base[pd.ref] = D; }
      pileup[String(pd.pos)] = base;
    }
    return pileup;
  }, []);

  // ── For computeCustomHaplotypes: compute directly from enc schema ──────
  const computeCustomHaplotypesFromEnc = useCallback((geneId, flags, posStart, posEnd) => {
    const cache = precomputedCache.current[geneId];
    if (!cache) return null;
    const { positionData, samples: sampleList } = cache;

    const filtered = positionData.filter(pd => {
      if (pd.pos < posStart || pd.pos > posEnd) return false;
      let match = false;
      if (flags.snp && pd.hasSnp) match = true;
      if (flags.indel && (pd.hasIns || pd.hasDel)) match = true;
      if (flags.gap && pd.hasNoCov) match = true;
      return match;
    });

    if (!filtered.length) {
      return {
        haplotypes: [{ id: 'Hap1', label: 'Haplotype 1', samples: [...sampleList],
          pattern: '', nSnp: 0, nGap: 0, nIns: 0, nVariants: 0, nSamples: sampleList.length }],
        variantPositions: [],
      };
    }

    const variantPositions = filtered.map(pd => pd.pos);
    const patternMap = new Map();

    for (let si = 0; si < sampleList.length; si++) {
      const sid = sampleList[si];
      const parts = filtered.map(pd => {
        const enc = pd.enc || '';
        const c = si < enc.length ? enc[si] : '0';
        if (c === '0') return pd.ref;
        if (c === '-') return '-';
        const altIdx = parseInt(c) - 1;
        return altIdx < (pd.alt || []).length ? pd.alt[altIdx] : pd.ref;
      });

      // Masking
      const masked = parts.map((a, i) => {
        const ref = filtered[i].ref;
        if (a === '-' && !flags.gap) return ref;
        if (a === 'D' && !flags.indel) return ref;
        if (a.includes('+') && !flags.indel) return a.split('+')[0];
        if (a !== '-' && a !== 'D' && !a.includes('+') && a !== ref && !flags.snp) return ref;
        return a;
      });

      const pat = masked.join('');
      if (!patternMap.has(pat)) patternMap.set(pat, []);
      patternMap.get(pat).push(sid);
    }

    const refPattern = filtered.map(pd => pd.ref).join('');
    const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
    const entries = [...patternMap.entries()].sort((a, b) =>
      hamming(a[0], refPattern) - hamming(b[0], refPattern) || b[1].length - a[1].length
    );

    const haplotypes = entries.map(([pat, samps], i) => {
      let nSnp = 0, nGap = 0, nIns = 0;
      for (let j = 0; j < filtered.length; j++) {
        const a = pat[j] === undefined ? filtered[j].ref : pat.charAt
          ? [...pat][j] : pat[j]; // handle as string
        const ref = filtered[j].ref;
        // re-extract per-position char from pattern string
      }
      // simpler: count from pattern vs ref
      for (let j = 0; j < variantPositions.length; j++) {
        const ref = filtered[j].ref;
        const patChars = [...pat];
        const a = patChars[j] ?? ref;
        if (a === ref) continue;
        if (a === '-' || a === 'D') nGap++;
        else if (a.includes('+')) nIns++;
        else nSnp++;
      }
      return { id: `Hap${i+1}`, label: `Haplotype ${i+1}`, samples: samps,
        pattern: pat, nSnp, nGap, nIns, nVariants: nSnp+nGap+nIns, nSamples: samps.length };
    });

    return { haplotypes, variantPositions };
  }, []);

  const getSampleIdxMap = useCallback((geneId) => {
    return precomputedCache.current[geneId]?.sampleIdxMap || {};
  }, []);

  const getSampleList = useCallback((geneId) => {
    return precomputedCache.current[geneId]?.samples || [];
  }, []);

  return {
    index, gene, samples, hapCombos, loading, pileupProgress,
    classifyFlags, setClassifyFlags, getHapData,
    loadIndex, loadGene, loadSamples,
    loadAllPileups: loadPrecomputed,
    loadPrecomputed,
    getPileup, getPositionData, getMsaInsData,
    getSampleIdxMap, getSampleList,
    computeCustomHaplotypesFromEnc,
  };
}
