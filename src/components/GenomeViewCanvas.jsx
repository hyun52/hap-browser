import React, { useMemo, useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import ReactDOM from 'react-dom';
import { HAP_COLORS, BASE_COL } from '../utils/constants.js';
import { getDominantAllele, buildMsaColumns } from '../utils/haplotype.js';
import { classifyPosition, REGION_COL, REGION_LBL, buildAnnotSegments } from '../utils/annotation.js';
import AnnotationRow from './AnnotationRow.jsx';
import RefCell from './RefCell.jsx';
import { localToRapdb } from '../utils/positionUtils.js';

const COL_W = 24;
const LABEL_W = 130;
const BUFFER = 30;

const GenomeViewCanvas = forwardRef(function GenomeViewCanvas({
  gene, hapData, regionPositionData, shownSamples, sampleHapMap, getPileup,
  viewRegion = 'all',
  viewFlags = { identical: true, snp: true, indel: true, gap: true },
  samples = [],
  posMode = 'rapdb',
  onTogglePosMode = null,
  gotoTarget = null,
  onColumnDragEnd = null,
  sampleIdxMap = {},
  sampleList = [],
  pileupProgress = 1,
  showProtein = false,
  sampleMeta = {},
}, ref) {
  // rowH: 28px (2 lines) when variety info is present, else 20px (1 line)
  // With useMemo, the boolean stays stable even if sampleMeta reference changes
  const hasAnyVariety = useMemo(
    () => sampleMeta && Object.values(sampleMeta).some(v => v?.variety),
    [sampleMeta]
  );
  const rowH = hasAnyVariety ? 28 : 20;
  const scrollRef = useRef(null);
  const minimapRef = useRef(null);
  const mmViewRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [activeRatioPopup, setActiveRatioPopup] = useState(null); // single global popup
  const [aaPopup, setAaPopupState] = useState(null);
  const [aaCopied, setAaCopied] = useState(false);
  const [hoveredCodon, setHoveredCodon] = useState(null);
  const aaPopupRef = useRef(null);

  // setAaPopup: keep state and ref in sync
  const setAaPopup = useCallback((val) => {
    const next = typeof val === 'function' ? val(aaPopupRef.current) : val;
    aaPopupRef.current = next;
    setAaPopupState(next);
  }, []);

  // Clipboard copy that works on both HTTP and HTTPS
  const copyText = useCallback((text) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(el);
      el.focus();
      el.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(el);
    }
  }, []);
  const [copiedPos, setCopiedPos] = useState(null); // recently copied position
  const [highlightPos, setHighlightPos] = useState(null); // highlighted position after goto
  const scrollLeftRef = useRef(0);
  const isDraggingRef = useRef(false);
  // ── Scroll-performance tuning ─────────────────────────────────────────
  // Large OVERSCAN lowers re-render frequency (memory cost is small)
  // TRIGGER_MARGIN: re-render when scroll crosses this distance past the buffer edge
  //   larger = fewer re-renders, but too large risks blank edges
  const OVERSCAN = 120;
  const TRIGGER_MARGIN = 40;
  const [renderRange, setRenderRange] = useState({ startIdx: 0, endIdx: 250 });
  const renderRangeRef = useRef({ startIdx: 0, endIdx: 250 });
  const [viewW, setViewW] = useState(800);
  const [dragSelection, setDragSelection] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const colDragRef = useRef({ active: false, startPos: null, endPos: null });

  // On gene change: reset scroll to 0 and reinitialize renderRange
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    scrollLeftRef.current = 0;
    const viewCols = Math.ceil((viewW || 800) / COL_W);
    const init = { startIdx: 0, endIdx: Math.max(viewCols + OVERSCAN, 250) };
    renderRangeRef.current = init;
    setRenderRange(init);
  }, [gene]); // eslint-disable-line

  // viewRegion/viewFlags change: keep scroll position, only recompute renderRange
  // Uses primitive deps → does not re-run just because an object reference changes
  useEffect(() => {
    const sl = scrollRef.current?.scrollLeft || 0;
    const currentStart = Math.floor(sl / COL_W);
    const viewCols = Math.ceil((viewW || 800) / COL_W);
    const init = {
      startIdx: Math.max(0, currentStart - OVERSCAN),
      endIdx: Math.max(currentStart + viewCols + OVERSCAN, 150),
    };
    renderRangeRef.current = init;
    setRenderRange(init);
  }, [viewRegion, viewFlags.identical, viewFlags.snp, viewFlags.indel, viewFlags.gap]); // eslint-disable-line

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const m = () => setViewW(el.clientWidth - LABEL_W);
    m(); const ro = new ResizeObserver(m); ro.observe(el); return () => ro.disconnect();
  }, []);

  // handleScroll: rAF-throttled — >60fps scroll events are wasted
  const scrollRafRef = useRef(null);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return;  // already scheduled → skip
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!scrollRef.current || !msaColumnsRef.current?.length) return;
      const sl = scrollRef.current.scrollLeft;
      scrollLeftRef.current = sl;

      // Manipulate minimap viewport directly (60fps without React re-render)
      if (mmViewRef.current && minimapRef.current) {
        const totalCols = msaColumnsRef.current.length;
        const mmW = minimapRef.current.clientWidth;
        const vw  = scrollRef.current.clientWidth - LABEL_W;
        const left  = (sl / (totalCols * COL_W)) * mmW;
        const width = Math.max(4, (vw / (totalCols * COL_W)) * mmW);
        mmViewRef.current.style.left  = `${Math.max(0, left)}px`;
        mmViewRef.current.style.width = `${width}px`;
      }

      // Only re-render React once scroll enters within TRIGGER_MARGIN of buffer edge
      const currentStart = Math.floor(sl / COL_W);
      const currentEnd   = Math.ceil((sl + viewW) / COL_W);
      const rr = renderRangeRef.current;
      if (currentStart < rr.startIdx + TRIGGER_MARGIN || currentEnd > rr.endIdx - TRIGGER_MARGIN) {
        const newRange = {
          startIdx: Math.max(0, currentStart - OVERSCAN),
          endIdx: Math.min(msaColumnsRef.current.length - 1, currentEnd + OVERSCAN),
        };
        renderRangeRef.current = newRange;
        setRenderRange(newRange);
      }
    });
  }, [viewW]); // eslint-disable-line

  // cleanup scroll RAF on unmount
  useEffect(() => () => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  // Click+drag to scroll horizontally
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0 });

  const clientXToPos = useCallback((clientX) => {
    if (!scrollRef.current || !msaColumnsRef.current?.length) return null;
    const rect = scrollRef.current.getBoundingClientRect();
    const relX = clientX - rect.left - LABEL_W + scrollRef.current.scrollLeft;
    const ci = Math.max(0, Math.floor(relX / COL_W));
    const cols = msaColumnsRef.current;
    const col = cols[Math.min(ci, cols.length - 1)];
    return col ? (col.type === 'ref' ? col.pos : col.afterPos) : null;
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (!scrollRef.current) return;
    // If aaPopup is open, the document listener handles it — skip here
    if (aaPopup) return;
    // Clicks on thead ignore panning (th events like position copy take precedence)
    if (e.target.closest('thead')) return;
    const rect = scrollRef.current.getBoundingClientRect();
    if (e.clientX - rect.left < LABEL_W) return;

    if (e.shiftKey && onColumnDragEnd) {
      // ── Shift+drag: marker range selection ──
      const startPos = clientXToPos(e.clientX);
      colDragRef.current = { active: true, startPos, endPos: startPos };
      setDragSelection(startPos ? { startPos, endPos: startPos } : null);
      e.preventDefault();

      const onMove = (ev) => {
        const pos = clientXToPos(ev.clientX);
        if (pos) { colDragRef.current.endPos = pos; setDragSelection({ startPos: colDragRef.current.startPos, endPos: pos }); }
      };
      const onUp = () => {
        const { startPos: sp, endPos: ep } = colDragRef.current;
        colDragRef.current = { active: false, startPos: null, endPos: null };
        if (sp && ep && onColumnDragEnd) onColumnDragEnd(Math.min(sp, ep), Math.max(sp, ep));
        setDragSelection(null);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

    } else {
      // ── Normal drag: panning (horizontal scroll) ──
      const startX = e.clientX;
      const startScroll = scrollRef.current.scrollLeft;
      isDraggingRef.current = true;
      dragRef.current = { active: true, startX, startScroll };
      setIsPanning(true);
      e.preventDefault(); // prevent native drag hijack

      let rafId = null;
      const onMove = (ev) => {
        const next = startScroll + (startX - ev.clientX);
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (scrollRef.current) scrollRef.current.scrollLeft = next;
        });
      };
      const onUp = () => {
        if (rafId) cancelAnimationFrame(rafId);
        dragRef.current.active = false;
        isDraggingRef.current = false;
        setIsPanning(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  }, [onColumnDragEnd, clientXToPos]);

  // none (drag listeners are attached dynamically inside handleMouseDown)

  const msaColumnsRef = useRef([]);
  const showAll = viewFlags.identical && viewFlags.snp && viewFlags.indel && viewFlags.gap;

  // Build gene/CDS position sets for region filtering
  const { genePositionSet, cdsPositionSet } = useMemo(() => {
    if (!gene) return { genePositionSet: null, cdsPositionSet: null };
    const gls = gene.gene_start - gene.offset;
    const gle = gene.gene_end - gene.offset;
    const geneSet = new Set();
    for (let p = gls; p <= gle; p++) geneSet.add(p);

    const targetMrnaIds = new Set();
    gene.features.forEach(f => { if (f.type === 'mRNA' && f.attrs?.Locus_id === gene.id) targetMrnaIds.add(f.attrs.ID); });
    const cdsSet = new Set();
    gene.features.forEach(f => {
      if ((f.type === 'CDS' || f.type === 'exon') && f.attrs?.Parent && targetMrnaIds.has(f.attrs.Parent)) {
        for (let p = f.start; p <= f.end; p++) cdsSet.add(p);
      }
    });
    return { genePositionSet: geneSet, cdsPositionSet: cdsSet };
  }, [gene]);

  // Compute relative position per viewRegion
  const relPosMap = useMemo(() => {
    if (!gene) return null;
    if (viewRegion === 'gene' && genePositionSet) {
      const sorted = [...genePositionSet].sort((a, b) => a - b);
      const m = new Map();
      sorted.forEach((p, i) => m.set(p, i + 1));
      return m;
    }
    if (viewRegion === 'cds' && cdsPositionSet) {
      const sorted = [...cdsPositionSet].sort((a, b) => a - b);
      const m = new Map();
      sorted.forEach((p, i) => m.set(p, i + 1));
      return m;
    }
    return null;
  }, [gene, viewRegion, genePositionSet, cdsPositionSet]);

  // Set of all variant positions for fast lookup
  const regionPosSet = useMemo(() => new Set(regionPositionData.map(pd => pd.pos)), [regionPositionData]);

  const pdMap = useMemo(() => {
    const m = new Map();
    regionPositionData.forEach(pd => m.set(pd.pos, pd));
    return m;
  }, [regionPositionData]);

  // Build set of variant positions from regionPositionData, filtered by viewFlags
  const variantPositionSet = useMemo(() => {
    const set = new Set();
    for (const pd of regionPositionData) {
      let include = false;
      if (viewFlags.snp && pd.hasSnp) include = true;
      if (viewFlags.indel && (pd.hasIns || pd.hasDel)) include = true;
      if (viewFlags.gap && pd.hasNoCov) include = true;
      if (include) set.add(pd.pos);
    }
    return set;
  }, [regionPositionData, viewFlags]);

  // Positions based on viewRegion + viewFlags
  const allPositions = useMemo(() => {
    if (!gene || !hapData) return [];

    // All variant positions in region (any type)
    const allVariantSet = regionPosSet;

    let positions;
    if (showAll) {
      // Everything: all bp in region
      const arr = [];
      for (let p = 1; p <= gene.region_length; p++) arr.push(p);
      positions = arr;
    } else {
      const wantIdentical = viewFlags.identical;
      const wantSomeVariants = viewFlags.snp || viewFlags.indel || viewFlags.gap;

      if (wantIdentical && !wantSomeVariants) {
        // Identical ONLY: all bp MINUS all variant positions
        const arr = [];
        for (let p = 1; p <= gene.region_length; p++) {
          if (!allVariantSet.has(p)) arr.push(p);
        }
        positions = arr;
      } else if (wantIdentical && wantSomeVariants) {
        // Identical + selected variant types
        const arr = [];
        for (let p = 1; p <= gene.region_length; p++) {
          if (!allVariantSet.has(p)) { arr.push(p); continue; } // identical
          if (variantPositionSet.has(p)) arr.push(p); // variant matching flags
        }
        positions = arr;
      } else if (wantSomeVariants) {
        // Only variant positions matching flags (no identical)
        positions = [...variantPositionSet].sort((a, b) => a - b);
      } else {
        // Nothing selected
        positions = [];
      }
    }

    // Filter by viewRegion
    if (viewRegion === 'gene' && genePositionSet) {
      positions = positions.filter(p => genePositionSet.has(p));
    } else if (viewRegion === 'cds' && cdsPositionSet) {
      positions = positions.filter(p => cdsPositionSet.has(p));
    }

    return positions;
  }, [gene, hapData, showAll, viewFlags, viewRegion, genePositionSet, cdsPositionSet, variantPositionSet, regionPosSet]);

  // Build MSA columns (ref + insertion columns)
  const showInsColumns = viewFlags.indel;
  const { msaColumns, sampleInsMap } = useMemo(() => {
    if (!allPositions.length || !gene || !samples.length) {
      return { msaColumns: allPositions.map(p => ({ type: 'ref', pos: p })), sampleInsMap: {} };
    }
    return buildMsaColumns(allPositions, samples, getPileup, gene.id, showInsColumns);
  }, [allPositions, samples, getPileup, gene, showInsColumns]);

  msaColumnsRef.current = msaColumns;
  const totalW = msaColumns.length * COL_W;

  // ── AltRatio cache: compute once per variant position when gene loads ───
  // ── JIT caching: compute on first on-screen use, O(1) afterwards ────────
  const altRatioCacheRef = useRef({});
  // Reset cache when gene/samples change
  // Reset cache on gene/samples change or after pileup load
  useEffect(() => { altRatioCacheRef.current = {}; }, [gene?.id, samples, pileupProgress]);
  useEffect(() => { setAaPopup(null); }, [gene?.id, setAaPopup]); // close popup on gene change

  const getCachedAltRatio = useCallback((pos) => {
    if (altRatioCacheRef.current[pos] !== undefined) return altRatioCacheRef.current[pos];
    const ref = gene.seq[pos - 1] || 'N';
    let mapped = 0, noCov = 0, altDom = 0, refDom = 0;
    let refCount = 0, altCount = 0;
    const baseTotals = { A:0, T:0, G:0, C:0, del:0, ins:0 };

    const isVariantPos = regionPositionData?.some(p => p.pos === pos);

    for (const sid of samples) {
      const pileup = getPileup(gene.id, sid);
      let p = pileup ? pileup[String(pos)] : null;

      // Collapsed Identical columns → restore as 100% reference
      if (!p) {
        if (isVariantPos) {
          // Gap (no mapping): count as a variant (distinct from deletion but aggregated as alt)
          mapped++;
          altDom++;
          altCount += 10; // pseudo depth
          baseTotals.gap = (baseTotals.gap || 0) + 10;
          continue;
        } else {
          p = { A:0, T:0, G:0, C:0, del:0, ins:0 };
          if ('ATGC'.includes(ref)) p[ref] = 10; // restore elided ref data
        }
      }

      const tot = (p.A||0)+(p.T||0)+(p.G||0)+(p.C||0)+(p.del||0)+(p.ins||0);
      if (tot === 0) {
        // tot=0: pileup present but depth 0 → Gap (no mapping)
        if (isVariantPos) {
          mapped++;
          altDom++;
          altCount += 10;
          baseTotals.gap = (baseTotals.gap || 0) + 10;
        } else {
          noCov++;
        }
        continue;
      }
      if (tot < 5) { noCov++; continue; }
      mapped++;
      for (const b of ['A','T','G','C','del','ins']) baseTotals[b] += (p[b]||0);
      const rCount = p[ref] || 0;
      const aCount = tot - rCount;
      refCount += rCount;
      altCount += aCount;
      const bases = { A:p.A||0, T:p.T||0, G:p.G||0, C:p.C||0, del:p.del||0, ins:p.ins||0 };
      const dom = Object.entries(bases).sort((a,b)=>b[1]-a[1])[0][0];
      if (dom !== ref) altDom++; else refDom++;
    }
    const totalReads = refCount + altCount;
    const result = {
      mapped, noCov, altDom, refDom, ref, baseTotals,
      refCount, altCount, totalSamples: mapped, nSamples: samples.length,
      altPct: totalReads > 0 ? Math.round(altCount/totalReads*100) : 0,
    };
    altRatioCacheRef.current[pos] = result;
    return result;
  }, [gene, samples, getPileup, regionPositionData]); // eslint-disable-line

  const { visibleCols, padLeft, padRight } = useMemo(() => {
    const total = msaColumns.length;
    if (!total) return { visibleCols: [], padLeft: 0, padRight: 0 };
    if (total * COL_W <= viewW + LABEL_W) return { visibleCols: msaColumns, padLeft: 0, padRight: 0 };
    // renderRange-based: recompute only when buffer edge is reached (no re-render during scroll)
    const si = renderRange.startIdx;
    const ei = renderRange.endIdx;
    const vis = msaColumns.slice(si, ei + 1);
    return {
      visibleCols: vis,
      padLeft: si * COL_W,
      padRight: Math.max(0, totalW - (ei + 1) * COL_W),
    };
  }, [msaColumns, renderRange, viewW, totalW]);

  const hasPad = padLeft > 0 || padRight > 0;

  // Extract just ref positions from visible cols for annotation/region cache
  const visibleRefPositions = useMemo(() => visibleCols.filter(c => c.type === 'ref').map(c => c.pos), [visibleCols]);

  const groups = useMemo(() => {
    if (!hapData) return [];
    return hapData.haplotypes.map((h, i) => ({
      ...h, color: HAP_COLORS[i % HAP_COLORS.length],
      vis: h.samples.filter(s => shownSamples.includes(s)),
    })).filter(g => g.vis.length > 0);
  }, [hapData, shownSamples]);

  const regionCache = useMemo(() => {
    const c = {};
    visibleRefPositions.forEach(p => { c[p] = classifyPosition(p, gene); });
    return c;
  }, [visibleRefPositions, gene]);

  const annotSegments = useMemo(() => buildAnnotSegments(visibleCols, regionCache), [visibleCols, regionCache]);

  const handleHover = useCallback((e, sid, col) => {
    if (!gene) return;
    // col can be { type:'ref', pos } or { type:'ins', afterPos, insIdx }
    if (col.type === 'ins') {
      const insSeq = sampleInsMap[sid]?.[col.afterPos] || '';
      const insBase = insSeq[col.insIdx] || '-';
      setTip({
        x: Math.min(e.clientX + 14, window.innerWidth - 230),
        y: Math.min(e.clientY - 10, window.innerHeight - 200),
        pos: col.afterPos, rapPos: localToRapdb(col.afterPos, gene.offset), ref: '-',
        base: insBase, isRef: false,
        depth: 0, counts: null, isDel: false, isIns: true,
        isNoCov: false, insSeqs: null,
        sid, hapId: sampleHapMap[sid] || '?',
        region: 'Insertion', regionColor: '#7c3aed',
        isInsCol: true, insIdx: col.insIdx, fullInsSeq: insSeq,
      });
      return;
    }
    const pos = col.pos;
    const pileup = getPileup(gene.id, sid);
    const ref = (gene.seq[pos - 1] || 'N');
    const info = getDominantAllele(pileup, pos, ref);
    const rt = regionCache[pos] || classifyPosition(pos, gene);
    setTip({
      x: Math.min(e.clientX + 14, window.innerWidth - 230),
      y: Math.min(e.clientY - 10, window.innerHeight - 200),
      pos, rapPos: localToRapdb(pos, gene.offset), ref, base: info.base, isRef: info.isRef,
      depth: info.depth, counts: info.counts, isDel: info.isDel, isIns: info.isIns,
      isNoCov: info.isNoCov, insSeqs: info.insSeqs,
      sid, hapId: sampleHapMap[sid] || '?',
      region: REGION_LBL[rt] || rt, regionColor: REGION_COL[rt],
      isInsCol: false,
    });
  }, [gene, getPileup, sampleHapMap, regionCache, sampleInsMap]);

  // Force-update renderRange (used on jumps)
  const jumpToIdx = useCallback((idx) => {
    if (!scrollRef.current || idx < 0) return;
    scrollRef.current.scrollLeft = Math.max(0, idx * COL_W - viewW / 2);
    const total = msaColumnsRef.current?.length || 0;
    const newRange = {
      startIdx: Math.max(0, idx - 50),
      endIdx: Math.min(total - 1, idx + 50 + Math.ceil(viewW / COL_W)),
    };
    renderRangeRef.current = newRange;
    setRenderRange(newRange);
  }, [viewW]);

  const handleMinimapClick = useCallback((e) => {
    if (!minimapRef.current || !msaColumnsRef.current?.length) return;
    const rect = minimapRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetIdx = Math.floor(frac * msaColumnsRef.current.length);
    jumpToIdx(targetIdx);
  }, [jumpToIdx]);

  // gotoTarget
  useEffect(() => {
    if (!gotoTarget || !msaColumnsRef.current?.length) return;
    const idx = msaColumnsRef.current.findIndex(c => c.type === 'ref' && c.pos === gotoTarget);
    if (idx < 0) return; // do not move if no exact position match
    jumpToIdx(idx);
    setHighlightPos(gotoTarget);
    setTimeout(() => setHighlightPos(null), 2000);
  }, [gotoTarget, jumpToIdx]);

  // aaPopup outside click → auto-copy and close (register only once on mount)
  useEffect(() => {
    const handleDocMouseDown = (e) => {
      if (!aaPopupRef.current) return;
      const popupEl = document.querySelector('.ratio-popup');
      if (popupEl && popupEl.contains(e.target)) return;
      const header = 'Sample\tRef AA position\tRef Codon\tAlt Codon\tRef AA\tAlt AA\tType\n';
      const lines = Object.entries(aaPopupRef.current.results)
        .map(([sid, r]) => `${sid}\t${aaPopupRef.current.cn}\t${aaPopupRef.current.refCodon||''}\t${r.codon||''}\t${r.refAA||'-'}\t${r.aa||'-'}\t${r.type}`)
        .join('\n');
      copyText(header + lines);
      setAaPopup(null);
      setAaCopied(true);
      setTimeout(() => setAaCopied(false), 1500);
    };
    document.addEventListener('mousedown', handleDocMouseDown, true);
    return () => document.removeEventListener('mousedown', handleDocMouseDown, true);
  }, []); // mount-only — always access latest via aaPopupRef

  useImperativeHandle(ref, () => ({
    scrollToPos: (localPos) => {
      const idx = msaColumnsRef.current?.findIndex(c => c.type === 'ref' && c.pos >= localPos);
      jumpToIdx(idx ?? -1);
    },
    getCachedAltRatio,
    getAllPositions: () => allPositions,
    getMsaColumns: () => msaColumnsRef.current,  // full ref+ins columns
    getSampleInsMap: () => sampleInsMap,
  }));

  if (!gene) return <div className="vo-empty">← Select a gene</div>;
  if (!hapData) return <div className="vo-empty">Computing haplotypes…</div>;
  if (!allPositions.length) return <div className="vo-empty">No variants found</div>;

  const len = gene.region_length;
  const gls = gene.gene_start - gene.offset;
  const gle = gene.gene_end - gene.offset;
  const regionLabels = { all: 'Full Region', gene: 'Gene Body', cds: 'CDS' };
  const activeShow = [viewFlags.identical && 'Identical', viewFlags.snp && 'SNP', viewFlags.indel && 'InDel', viewFlags.gap && 'Gap'].filter(Boolean);
  const modeLabel = `${regionLabels[viewRegion]} · ${activeShow.join('+') || 'None'}`;
  const showMinimap = totalW > viewW;

  // Protein view: pos → {ci, cn, cp} mapping
  const cdsMapRef = useMemo(() => {
    if (!showProtein || !gene?.cdsMap) return new Map();
    const m = new Map();
    Object.entries(gene.cdsMap).forEach(([pos, info]) => m.set(parseInt(pos), info));
    return m;
  }, [showProtein, gene?.cdsMap]);

  const GENETIC_CODE = {
    ATA:'I',ATC:'I',ATT:'I',ATG:'M',ACA:'T',ACC:'T',ACG:'T',ACT:'T',
    AAC:'N',AAT:'N',AAA:'K',AAG:'K',AGC:'S',AGT:'S',AGA:'R',AGG:'R',
    CTA:'L',CTC:'L',CTG:'L',CTT:'L',CCA:'P',CCC:'P',CCG:'P',CCT:'P',
    CAC:'H',CAT:'H',CAA:'Q',CAG:'Q',CGA:'R',CGC:'R',CGG:'R',CGT:'R',
    GTA:'V',GTC:'V',GTG:'V',GTT:'V',GCA:'A',GCC:'A',GCG:'A',GCT:'A',
    GAC:'D',GAT:'D',GAA:'E',GAG:'E',GGA:'G',GGC:'G',GGG:'G',GGT:'G',
    TCA:'S',TCC:'S',TCG:'S',TCT:'S',TTC:'F',TTT:'F',TTA:'L',TTG:'L',
    TAC:'Y',TAT:'Y',TAA:'*',TAG:'*',TGC:'C',TGT:'C',TGA:'*',TGG:'W',
  };
  const AA_COL = { nonsynonymous:'#ef4444', stop:'#7c3aed', synonymous:'#16a34a' };
  const hasInsertions = Object.keys(sampleInsMap).some(sid => Object.keys(sampleInsMap[sid]).length > 0);

  // Minimap annotation features
  const targetMrnaIds = new Set();
  gene.features.forEach(f => { if (f.type === 'mRNA' && f.attrs?.Locus_id === gene.id) targetMrnaIds.add(f.attrs.ID); });
  const cdsFeatures = gene.features.filter(f => (f.type === 'CDS' || f.type === 'exon') && f.attrs?.Parent && targetMrnaIds.has(f.attrs.Parent));
  const utrFeatures = gene.features.filter(f => (f.type === 'five_prime_UTR' || f.type === 'three_prime_UTR') && f.attrs?.Parent && targetMrnaIds.has(f.attrs.Parent));
  const neighborGenes = gene.features.filter(f =>
    f.type === 'gene' &&
    f.attrs?.ID !== gene.id
  );

  // For minimap: map bp positions to column fraction (use msaColumns)
  const mmMapBpToFrac = (bp) => {
    if (showAll && viewRegion === 'all') {
      // Full region all positions — direct proportion
      let idx = 0;
      for (let i = 0; i < msaColumns.length; i++) {
        if (msaColumns[i].type === 'ref' && msaColumns[i].pos >= bp) { idx = i; break; }
        if (i === msaColumns.length - 1) idx = i;
      }
      return idx / msaColumns.length;
    }
    // Other modes: binary search
    let lo = 0, hi = msaColumns.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const col = msaColumns[mid];
      const colPos = col.type === 'ref' ? col.pos : col.afterPos;
      if (colPos < bp) lo = mid + 1; else hi = mid;
    }
    return lo / msaColumns.length;
  };

  const mmMapRangeFrac = (startBp, endBp) => {
    const s = mmMapBpToFrac(startBp);
    const e = mmMapBpToFrac(endBp);
    return { x: s * 100, w: Math.max((e - s) * 100, 0.3) };
  };

  return (
    <div className="vo-wrap">
      {/* Legend */}
      <div className="vo-legend">
        <span className="vo-leg-title">{modeLabel}</span>
        <span style={{ fontSize: 9, color: '#999', fontFamily: 'var(--mono)' }}>
          {allPositions.length.toLocaleString()} {showAll ? 'bp' : 'positions'}
        </span>
        <span className="vo-leg-sep" />
        <span className="vo-leg-title">Region:</span>
        {Object.entries(REGION_LBL).map(([k, l]) => (
          <span key={k} className="vo-leg-item"><span className="vo-leg-dot" style={{ background: REGION_COL[k] }} />{l}</span>
        ))}
        <span className="vo-leg-sep" />
        <span className="vo-leg-title">Base:</span>
        {['A', 'T', 'G', 'C'].map(b => (
          <span key={b} className="vo-leg-item"><span className="vo-leg-dot" style={{ background: BASE_COL[b] }} />{b}</span>
        ))}
        <span className="vo-leg-item"><span className="vo-leg-dot" style={{ background: '#c0bdb6' }} />Gap</span>
        <span className="vo-leg-item"><span className="vo-leg-dot" style={{ background: '#ede9fe', border: '1px solid #c4b5fd' }} />Ins col</span>
        <span className="vo-leg-item" title="Variant density in minimap top track"><span className="vo-leg-dot" style={{ background: 'linear-gradient(90deg,#f5e6b8,#dc5020)' }} />Density</span>
      </div>

      {/* Minimap: 3-track layout (density + main gene + neighbor genes) */}
      {showMinimap && (() => {
        // ── B1: Variant density bins (40 bins across full region) ────
        const N_BINS = 40;
        const bins = new Array(N_BINS).fill(0);
        const regLen = gene.region_length;
        if (regLen > 0 && regionPositionData?.length) {
          for (const pd of regionPositionData) {
            // only variants that match current viewFlags
            const include =
              (viewFlags.snp && pd.hasSnp) ||
              (viewFlags.indel && (pd.hasIns || pd.hasDel)) ||
              (viewFlags.gap && pd.hasNoCov);
            if (!include) continue;
            const bi = Math.min(N_BINS - 1, Math.floor((pd.pos - 1) / regLen * N_BINS));
            bins[bi]++;
          }
        }
        const maxBin = Math.max(1, ...bins);
        const densityCells = bins.map((c, i) => {
          if (c === 0) return null;
          const intensity = c / maxBin;  // 0..1
          // light yellow → orange → red gradient
          const r = 220, g = Math.round(160 * (1 - intensity) + 20 * intensity), b = Math.round(80 * (1 - intensity) + 20 * intensity);
          const x = (i / N_BINS) * 100;
          const w = 100 / N_BINS;
          return <rect key={i} x={x} y={1} width={w} height={6}
            fill={`rgb(${r},${g},${b})`} opacity={0.35 + 0.65 * intensity}>
            <title>{`bin ${i+1}/${N_BINS}: ${c} variant${c===1?'':'s'}`}</title>
          </rect>;
        });

        return (
        <div className="fr-minimap" ref={minimapRef} onClick={handleMinimapClick}>
          <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}
            viewBox="0 0 100 52" preserveAspectRatio="none">

            {/* ── Track 0 (y:1~7): Variant density heatmap ── */}
            {densityCells}

            {/* ── Track 1 (y:14~34): main gene — lowered to make room for label */}
            {/* Intron: thin gray line */}
            {(() => { const s=mmMapBpToFrac(gls)*100; const e=mmMapBpToFrac(gle)*100;
              return <rect x={s} y={23} width={e-s} height={2} fill="#9ca3af" rx="0.5" />; })()}
            {/* UTR — purple, shorter */}
            {utrFeatures.map((f,i) => { const { x, w } = mmMapRangeFrac(f.start, f.end);
              return <rect key={`u${i}`} x={x} y={21} width={w} height={6} fill="#7c3aed" rx="0.3" />; })}
            {/* CDS — green */}
            {cdsFeatures.map((f,i) => { const { x, w } = mmMapRangeFrac(f.start, f.end);
              return <rect key={`c${i}`} x={x} y={19} width={w} height={10} fill="#16a34a" rx="0.3" />; })}

            {/* Divider */}
            <line x1={0} y1={37} x2={100} y2={37} stroke="#d1d5db" strokeWidth="0.4" />

            {/* ── Track 2 (y:38~52): neighbor genes ── */}
            {neighborGenes.map((f, i) => {
              const { x, w } = mmMapRangeFrac(f.start, f.end);
              return <rect key={`nb${i}`} x={x} y={39} width={w} height={11}
                fill="rgba(251,146,60,0.4)" stroke="rgba(234,88,12,0.8)" strokeWidth="0.5" rx="1" />;
            })}
          </svg>

          {/* Density track label — tiny, left-aligned */}
          <div style={{
            position:'absolute', left:3, top:'1px', fontSize:7, color:'var(--t2)',
            fontFamily:'var(--mono)', letterSpacing:.3, pointerEvents:'none',
            textShadow:'0 0 3px var(--bg2)'
          }}>variant density</div>

          {/* Track 1: main gene label — lowered so it does not overlap density track */}
          <div className="fr-mm-gene-label" style={{
            left:`${Math.min(Math.max(mmMapBpToFrac((gls+gle)/2)*100, 5), 95)}%`,
            top:'9px'
          }}>
            {gene.sym} {gene.strand === '+' ? '→' : '←'}
          </div>

          {/* Track 2: neighbor gene labels — alternated above/below to prevent overlap */}
          {neighborGenes.map((f, i) => {
            const { x, w } = mmMapRangeFrac(f.start, f.end);
            const cx    = Math.min(Math.max(x + w/2, 4), 96);
            const name  = (f.attrs?.Name || f.attrs?.ID || '').split(',')[0];
            const strand = f.attrs?.strand || f.strand || '+';
            const topPx = i % 2 === 0 ? '28px' : '42px';
            return (
              <div key={`nl${i}`} className="fr-mm-ng-label"
                style={{ left:`${cx}%`, top:topPx }}>
                {name} {strand === '+' ? '→' : '←'}
              </div>
            );
          })}

          {/* Viewport */}
          <div ref={mmViewRef} className="fr-mm-view" style={{
            left: `${(scrollLeftRef.current / totalW) * 100}%`,
            width: `${Math.max((viewW / totalW) * 100, 0.5)}%`,
            top:'1px', bottom:'1px',
            transition: 'none',
          }} />

        </div>
        );
      })()}
      {/* Neighbor gene labels (below minimap) */}
      {neighborGenes.length > 0 && (
        <div style={{ position:'relative', height:13, background:'var(--bg2)',
          borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          {neighborGenes.map((f, i) => {
            const fracRange = mmMapRangeFrac(f.start, f.end);
            const leftPct  = parseFloat(fracRange.left) * 100;
            const widthPct = parseFloat(fracRange.width) * 100;
            const centerPct = (leftPct + widthPct / 2).toFixed(1);
            const rawId  = f.attrs?.Name || f.attrs?.ID || '';
            // Extract symbol from RAP-DB ID: show Os06g0274950 as-is
            const name   = rawId.split(',')[0];
            const strand = f.attrs?.strand || f.strand || '+';
            return (
              <span key={`nl${i}`} className="fr-mm-ng-label"
                style={{ left:`${centerPct}%` }}>
                {name} {strand === '+' ? '→' : '←'}
              </span>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="vo-scroll" ref={scrollRef}
        tabIndex={0}
        onScroll={handleScroll}
        onMouseDown={(e) => {
          // Acquire keyboard focus on panel click (for arrow-key navigation)
          if (scrollRef.current && document.activeElement !== scrollRef.current) {
            // focus must come after handleMouseDown so event order stays correct
            requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
          }
          handleMouseDown(e);
        }}
        onKeyDown={(e) => {
          if (!scrollRef.current) return;
          const cols = msaColumnsRef.current?.length || 0;
          if (!cols) return;
          // Yield to browser shortcuts when modifier keys are held
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          const el = scrollRef.current;
          const pageStep = Math.max(COL_W, viewW * 0.85);
          switch (e.key) {
            case 'ArrowLeft':
              e.preventDefault();
              el.scrollLeft = Math.max(0, el.scrollLeft - (e.shiftKey ? pageStep : COL_W * 3));
              break;
            case 'ArrowRight':
              e.preventDefault();
              el.scrollLeft = Math.min(cols * COL_W, el.scrollLeft + (e.shiftKey ? pageStep : COL_W * 3));
              break;
            case 'ArrowUp':
              e.preventDefault();
              el.scrollTop = Math.max(0, el.scrollTop - (e.shiftKey ? 200 : 40));
              break;
            case 'ArrowDown':
              e.preventDefault();
              el.scrollTop = el.scrollTop + (e.shiftKey ? 200 : 40);
              break;
            case 'Home':
              e.preventDefault();
              el.scrollLeft = 0;
              break;
            case 'End':
              e.preventDefault();
              el.scrollLeft = cols * COL_W;
              break;
            case 'PageUp':
              e.preventDefault();
              el.scrollLeft = Math.max(0, el.scrollLeft - pageStep);
              break;
            case 'PageDown':
              e.preventDefault();
              el.scrollLeft = Math.min(cols * COL_W, el.scrollLeft + pageStep);
              break;
            default: break;
          }
        }}
        onMouseLeave={() => setTip(null)}
        style={{ cursor: isPanning ? 'grabbing' : 'grab', userSelect: 'none', outline: 'none' }}>
        <div style={{ width: LABEL_W + totalW, minWidth: LABEL_W + totalW }}>
        <table className="vo-table" style={{ width: LABEL_W + totalW, minWidth: LABEL_W + totalW, tableLayout: 'fixed' }}>
          <thead>
            <AnnotationRow gene={gene} annotSegments={annotSegments} colW={COL_W} padLeft={hasPad ? padLeft : 0} padRight={hasPad ? padRight : 0} />

            <tr className="vo-stripe">
              <th className="vo-label vo-corner" />
              {hasPad && padLeft > 0 && <th style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft, padding: 0, border: 'none', background: '#f5f4f1' }} />}
              {visibleCols.map((col, i) => {
                if (col.type === 'ins') {
                  return <th key={`ins-${col.afterPos}-${col.insIdx}`} className="vo-stripe-cell vo-ins-stripe" />;
                }
                return <th key={col.pos} className="vo-stripe-cell" style={{ background: REGION_COL[regionCache[col.pos]] || '#ddd' }} />;
              })}
              {hasPad && padRight > 0 && <th style={{ width: padRight, minWidth: padRight, maxWidth: padRight, padding: 0, border: 'none', background: '#f5f4f1' }} />}
            </tr>
            <tr className="vo-pos-row">
              <th className="vo-label vo-corner-pos">
                <span className="vo-corner-gene" style={{fontSize:10, fontWeight:700, color:'var(--teal)'}}>
                  {posMode === 'rapdb' ? 'RAP-DB' : viewRegion === 'all' ? 'Local' : viewRegion === 'gene' ? 'Gene' : 'CDS'}<br/>
                  <span style={{fontWeight:400, color:'var(--t2)', fontSize:9}}>position</span>
                </span>
                <button
                  className={`vo-pos-mode-btn${posMode === 'rapdb' ? '' : ' active'}`}
                  title="Toggle RAP-DB / Local position"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onTogglePosMode && onTogglePosMode(); }}
                >
                  {posMode === 'rapdb' ? '→ Local' : '→ RAP-DB'}
                </button>
              </th>
              {hasPad && padLeft > 0 && <th style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft, padding: 0, border: 'none', background: '#f5f4f1' }} />}
              {visibleCols.map((col, i) => {
                if (col.type === 'ins') {
                  return <th key={`ins-${col.afterPos}-${col.insIdx}`} className="vo-pos-th vo-ins-pos-th" title={`Insertion after ${col.afterPos}, idx ${col.insIdx}`}><span className="vo-pos-num vo-ins-pos-num">·</span></th>;
                }
                // Compute position value to display
                const dispPos = posMode === 'rapdb'
                  ? localToRapdb(col.pos, gene.offset).toLocaleString()
                  : relPosMap
                    ? (relPosMap.get(col.pos) ?? col.pos).toLocaleString()
                    : col.pos.toLocaleString();
                const copyVal = posMode === 'rapdb'
                  ? String(localToRapdb(col.pos, gene.offset))
                  : relPosMap
                    ? String(relPosMap.get(col.pos) ?? col.pos)
                    : String(col.pos);
                return (
                  <th key={col.pos}
                    className={`vo-pos-th vo-pos-clickable${copiedPos === col.pos ? ' vo-pos-copied-th' : ''}${highlightPos === col.pos ? ' vo-pos-highlight' : ''}`}
                    title={`Click to copy position`}
                    style={{ cursor: 'pointer', position: 'relative' }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => {
                      e.stopPropagation();
                      copyText(copyVal);
                      setCopiedPos(col.pos);
                      setTimeout(() => setCopiedPos(null), 900);
                    }}>
                    <span className="vo-pos-num">{dispPos}</span>
                    {copiedPos === col.pos && (
                      <span style={{
                        position:'fixed', zIndex:9999,
                        background:'#1d4ed8', color:'#fff',
                        fontSize:11, padding:'3px 8px', borderRadius:4,
                        pointerEvents:'none', whiteSpace:'nowrap',
                        fontFamily:'var(--sans)', fontWeight:600,
                        transform:'translateX(-50%)',
                        marginTop:'-32px',
                      }}>Copied!</span>
                    )}
                  </th>
                );
              })}
              {hasPad && padRight > 0 && <th style={{ width: padRight, minWidth: padRight, maxWidth: padRight, padding: 0, border: 'none', background: '#f5f4f1' }} />}
            </tr>
            <tr className="vo-ref-row">
              <td className="vo-label vo-ref-label">Reference</td>
              {hasPad && padLeft > 0 && <td style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft, padding: 0, border: 'none', background: '#f5f4f1' }} />}
              {visibleCols.map((col, i) => {
                if (col.type === 'ins') {
                  return <td key={`ins-${col.afterPos}-${col.insIdx}`} className="vo-cell vo-ref-cell vo-ins-ref-cell">-</td>;
                }
                return <RefCell key={col.pos} pos={col.pos} base={gene.seq[col.pos - 1] || 'N'} gene={gene} />;
              })}
              {hasPad && padRight > 0 && <td style={{ width: padRight, minWidth: padRight, maxWidth: padRight, padding: 0, border: 'none', background: '#f5f4f1' }} />}
            </tr>
            {/* ── Protein rows ── */}
            {showProtein && (() => {
              const refPdMap = new Map();
              (regionPositionData||[]).forEach(pd => refPdMap.set(pd.pos, pd));

              // Sample index map
              const sidxMap = {};
              (sampleList||[]).forEach((s,i) => { sidxMap[s]=i; });

              // Read sample allele (enc-based)
              const getSampleAllele = (pd, sid, refBase) => {
                if (!pd) return refBase;
                const si = sidxMap[sid] ?? -1;
                if (pd.enc !== undefined) {
                  if (si < 0 || si >= pd.enc.length) return refBase;
                  const ch = pd.enc[si];
                  if (ch==='0') return refBase;
                  if (ch==='-') return '-';
                  const ai = parseInt(ch)-1;
                  return ai < (pd.alt||[]).length ? pd.alt[ai] : refBase;
                }
                return pd.alleles?.[sid] ?? refBase;
              };

              // Codon translation cache (same codon key reused across 4 rows)
              const translateCache = new Map();

              // Three-position codon array → compute per-sample translated AA
              const translateForSamples = (codonPosList) => {
                const cacheKey = codonPosList.join(',');
                if (translateCache.has(cacheKey)) return translateCache.get(cacheKey);

                // codonPosList: [pos1, pos2, pos3] (ascending genomic order, cp 0/1/2)
                // On minus strand: reading order is reversed and each base is complemented
                const isMinus = gene?.strand === '-';
                const COMP = { A:'T', T:'A', G:'C', C:'G', N:'N', '-':'-' };
                const comp = (b) => COMP[b.toUpperCase()] || b;

                // Actual codon reading order (reversed on minus strand)
                const orderedPosList = isMinus ? [...codonPosList].reverse() : codonPosList;

                const results = {};
                const refBases = orderedPosList.map(pos => {
                  const info = cdsMapRef.get(pos);
                  return gene.cdsSeq?.[info?.ci] || 'N';
                });
                const refCodon = refBases.join('');
                const refAA = GENETIC_CODE[refCodon.toUpperCase()] || '?';

                for (const sid of (sampleList||[])) {
                  const bases = orderedPosList.map((pos, k) => {
                    const pd = refPdMap.get(pos);
                    const genomicAllele = getSampleAllele(pd, sid, isMinus ? comp(refBases[k]) : refBases[k]);
                    const a = isMinus ? comp(genomicAllele) : genomicAllele;
                    return a.includes('+') ? a[0] : (a === 'D' ? '-' : a);
                  });
                  const codon = bases.join('');
                  if (codon === refCodon) continue;
                  const aa = codon.includes('-') ? null : (GENETIC_CODE[codon.toUpperCase()] || '?');
                  let type = 'unknown';
                  if (aa === null) type = 'frameshift';
                  else if (aa === refAA) type = 'synonymous';
                  else if (aa === '*') type = 'stop';
                  else type = 'nonsynonymous';
                  results[sid] = { codon, aa, type, refAA };
                }
                const out = { results, refAA, refCodon };
                translateCache.set(cacheKey, out);
                return out;
              };

              // styles
              const lbSt = (color, bg) => ({
                background: bg||'var(--bg2)', color: 'var(--t1)', fontSize:'10px',
                fontWeight:500, padding:'3px 8px', textAlign:'left',
              });
              const lbDot = (_color) => ({ display:'none' }); // remove dot
              const cellSt = (bg) => ({
                padding:0, textAlign:'center', fontSize:'10px',
                fontFamily:'var(--mono)', background:bg||'var(--bg2)',
                borderBottom:'1px solid var(--bg3)',
                borderRight:'1px solid var(--border)',
              });

              // codon-merge row helper
              const codonRow = (label, bg, color, getCellContent, isClickable=false) => {
                const isMinus = gene?.strand === '-';
                // - strand: leftmost (smaller pos) is cp=2, rightmost (larger pos) is cp=0
                // Merge-start reference: + strand → cp=0, - strand → cp=2
                const startCp = isMinus ? 2 : 0;
                const consumed = new Set();
                const cells = [];
                for (let i = 0; i < visibleCols.length; i++) {
                  const col = visibleCols[i];
                  if (consumed.has(i)) continue;
                  if (col.type === 'ins') {
                    cells.push(<th key={`ins-${col.afterPos}-${col.insIdx}`}
                      style={{width:COL_W,minWidth:COL_W,maxWidth:COL_W,...cellSt(bg)}} />);
                    continue;
                  }
                  const info = cdsMapRef.get(col.pos);
                  if (!info) {
                    cells.push(<th key={col.pos} style={{width:COL_W,minWidth:COL_W,maxWidth:COL_W,...cellSt(bg)}} />);
                    continue;
                  }
                  if (info.cp !== startCp) {
                    cells.push(<th key={col.pos} style={{width:COL_W,minWidth:COL_W,maxWidth:COL_W,...cellSt(bg)}} />);
                    continue;
                  }
                  let span = 0;
                  const codonPosList = [];
                  for (let k = i; k < visibleCols.length; k++) {
                    const c2 = visibleCols[k];
                    if (c2.type === 'ins') break;
                    const i2 = cdsMapRef.get(c2.pos);
                    if (!i2 || i2.cn !== info.cn) break;
                    consumed.add(k); span++; codonPosList.push(c2.pos);
                  }
                  span = Math.max(span, 1);
                  // Pre-compute getCellContent to determine if cell is clickable
                  const cellContent = getCellContent(col, info, span, codonPosList, refPdMap);
                  const hasContent = isClickable && cellContent?.props?.children !== '·' && cellContent !== null;
                  const isHovered = hasContent && hoveredCodon === info.cn;
                  cells.push(
                    <th key={col.pos} colSpan={span}
                      onMouseEnter={hasContent ? () => setHoveredCodon(info.cn) : undefined}
                      onMouseLeave={hasContent ? () => setHoveredCodon(null) : undefined}
                      style={{width:COL_W*span,minWidth:COL_W*span,maxWidth:COL_W*span,
                        ...cellSt(isHovered ? '#dbeafe' : bg),
                        outline: isHovered ? '2px solid #2563eb' : 'none',
                        outlineOffset: '-2px',
                        cursor: hasContent ? 'pointer' : 'default',
                        transition: 'background .1s',
                      }}>
                      {cellContent}
                    </th>
                  );
                }
                return (
                  <tr style={{background:bg}}>
                    <th className="vo-label vo-ref-label" style={lbSt(color, bg)}>
                      <span style={lbDot(color)} />
                      {label}
                    </th>
                    {hasPad && padLeft > 0 && <th style={{width:padLeft,minWidth:padLeft,padding:0,border:'none',background:bg}} />}
                    {cells}
                    {hasPad && padRight > 0 && <th style={{width:padRight,minWidth:padRight,padding:0,border:'none',background:bg}} />}
                  </tr>
                );
              };

              const BG_AA  = '#f0fdf4';
              const BG_ALT = '#fff7ed';
              const BG_VAR = '#f8fafc';
              const BG_SYN = '#f0fdf4';
              const BG_NS  = '#fff1f2';
              const BG_FS  = '#fffbeb';

              return (
                <>
                  {/* Amino acid position */}
                  {codonRow('AA position', BG_VAR, 'var(--t2)',
                    (col, info) => <span style={{color:'var(--t2)',fontWeight:600}}>{info.cn}</span>
                  )}

                  {/* Reference amino acid */}
                  {codonRow('Ref AA', BG_AA, '#16a34a',
                    (col, info) => {
                      const codonStart = (info.cn - 1) * 3; // strand-independent, based on cn
                      const codon = gene.cdsSeq?.slice(codonStart, codonStart + 3) || '';
                      const aa = GENETIC_CODE[codon.toUpperCase()] || '?';
                      return <span style={{fontWeight:700,color:'#16a34a'}} title={codon}>{aa}</span>;
                    }
                  )}

                  {/* Alt amino acid: hover highlight, cell-click popup */}
                  {codonRow('Alt AA', BG_ALT, '#ea580c',
                    (col, info, span, codonPosList) => {
                      if (codonPosList.length < 3) return <span style={{color:'var(--t3)'}}>·</span>;
                      const { results, refCodon, refAA: rAA } = translateForSamples(codonPosList);
                      const altAAs = [...new Set(Object.values(results).map(r=>r.aa).filter(Boolean))];
                      if (!altAAs.length) return <span style={{color:'var(--t3)'}}>·</span>;
                      const label = altAAs.join(', ');
                      const isHov = hoveredCodon === info.cn;
                      const handleClick = (e) => {
                        e.stopPropagation();
                        setAaPopup({ x:e.clientX, y:e.clientY, cn:info.cn, results, refAA: rAA, refCodon });
                      };
                      return (
                        <span onClick={handleClick}
                          style={{fontWeight:700, color: isHov ? '#1d4ed8' : '#ea580c',
                            fontSize:'10px', display:'block', width:'100%', textAlign:'center'}}>
                          {label}
                        </span>
                      );
                    },
                    true  // isClickable
                  )}

                  {/* Synonymous count */}
                  {codonRow('Synonymous', BG_SYN, '#16a34a',
                    (col, info, span, codonPosList) => {
                      if (codonPosList.length < 3) return <span style={{color:'var(--t3)'}}>·</span>;
                      const { results } = translateForSamples(codonPosList);
                      const matched = Object.entries(results).filter(([,r])=>r.type==='synonymous');
                      const n = matched.length;
                      if (!n) return <span style={{color:'var(--t3)'}}>·</span>;
                      return (
                        <span title={matched.map(([sid,r])=>`${sid}: ${r.codon}→${r.aa}`).join('\n')}
                          style={{fontWeight:700,color:'#16a34a',cursor:'default'}}>{n}</span>
                      );
                    }
                  )}

                  {/* Non-synonymous count */}
                  {codonRow('Non-syn', BG_NS, '#ef4444',
                    (col, info, span, codonPosList) => {
                      if (codonPosList.length < 3) return <span style={{color:'var(--t3)'}}>·</span>;
                      const { results } = translateForSamples(codonPosList);
                      const matched = Object.entries(results).filter(([,r])=>r.type==='nonsynonymous'||r.type==='stop');
                      const n = matched.length;
                      if (!n) return <span style={{color:'var(--t3)'}}>·</span>;
                      return (
                        <span title={matched.map(([sid,r])=>`${sid}: ${r.codon}→${r.aa} (${r.type})`).join('\n')}
                          style={{fontWeight:700,color:'#ef4444',cursor:'default'}}>{n}</span>
                      );
                    }
                  )}

                  {/* Frameshift count */}
                  {codonRow('Frameshift', BG_FS, '#d97706',
                    (col, info, span, codonPosList) => {
                      if (codonPosList.length < 3) return <span style={{color:'var(--t3)'}}>·</span>;
                      const { results } = translateForSamples(codonPosList);
                      const matched = Object.entries(results).filter(([,r])=>r.type==='frameshift');
                      const n = matched.length;
                      if (!n) return <span style={{color:'var(--t3)'}}>·</span>;
                      return (
                        <span title={matched.map(([sid,r])=>`${sid}: ${r.codon}`).join('\n')}
                          style={{fontWeight:700,color:'#d97706',cursor:'default'}}>{n}</span>
                      );
                    }
                  )}
                </>
              );
            })()}

            {/* Alt sample ratio (how many samples have different major allele) */}
            <AltSampleRatioRow key={`alt-s-${pileupProgress}`} cols={visibleCols} gene={gene} samples={samples} getPileup={getPileup} sampleInsMap={sampleInsMap} getCachedAltRatio={getCachedAltRatio} ratioPopup={activeRatioPopup} setRatioPopup={setActiveRatioPopup}
              padLeft={hasPad ? padLeft : 0} padRight={hasPad ? padRight : 0} hasPad={hasPad} />
            {/* Alt read ratio (total alt reads / total reads) */}
            <AltReadRatioRow key={`alt-r-${pileupProgress}`} cols={visibleCols} gene={gene} samples={samples} getPileup={getPileup} getCachedAltRatio={getCachedAltRatio} ratioPopup={activeRatioPopup} setRatioPopup={setActiveRatioPopup}
              padLeft={hasPad ? padLeft : 0} padRight={hasPad ? padRight : 0} hasPad={hasPad} />
          </thead>
          <tbody>
            <tr>
              <td style={{
                position:'sticky', left:0, zIndex:4, padding:0, verticalAlign:'top',
                background:'var(--bg1)', width:LABEL_W, minWidth:LABEL_W,
                borderRight:'1px solid var(--border)', boxShadow:'2px 0 0 0 var(--bg1)'
              }}>
                <CanvasLabelCol groups={groups} sampleMeta={sampleMeta} rowH={rowH} />
              </td>
              <td style={{ padding:0, verticalAlign:'top', width:totalW, minWidth:totalW, position:'relative' }}>
                {/* spacer: keeps td height since Canvas is absolute */}
                <CanvasLabelColSpacer groups={groups} rowH={rowH} />
                <CanvasSampleRows
                  key={gene.id}
                  groups={groups}
                  gene={gene}
                  visibleCols={visibleCols}
                  msaColumnsFromParent={msaColumns}
                  padLeft={padLeft}
                  totalW={totalW}
                  viewW={viewW}
                  positionData={regionPositionData}
                  sampleIdxMap={sampleIdxMap}
                  sampleList={sampleList}
                  sampleInsMap={sampleInsMap}
                  dragSelection={dragSelection}
                  scrollRef={scrollRef}
                  isPanning={isPanning}
                  onHover={handleHover}
                  onLeave={() => setTip(null)}
                  rowH={rowH}
                />
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      {/* Tooltip */}
      {dragSelection && onColumnDragEnd && (
        <div className="vo-drag-hint">
          <span>⇔ <b>{localToRapdb(dragSelection.startPos,gene.offset).toLocaleString()}</b> – <b>{localToRapdb(dragSelection.endPos,gene.offset).toLocaleString()}</b></span>
          <span style={{color:'#94a3b8',marginLeft:6,fontSize:11}}>release → Marker Design</span>
        </div>
      )}
      {/* AA details popup */}
      {aaPopup && ReactDOM.createPortal(
        <div className="ratio-popup" style={{
          left: Math.max(10, Math.min(aaPopup.x - 10, window.innerWidth - 340)),
          top:  Math.max(10, Math.min(aaPopup.y + 12, window.innerHeight - 440)),
          position:'fixed', minWidth:280, maxWidth:340,
          userSelect:'text', whiteSpace:'normal',
        }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="ratio-popup-hd" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>Codon {aaPopup.cn} · Alt amino acids</span>
            <button onClick={() => {
              const header = 'Sample\tRef AA position\tRef Codon\tAlt Codon\tRef AA\tAlt AA\tType\n';
              const lines = Object.entries(aaPopup.results)
                .map(([sid,r]) => `${sid}\t${aaPopup.cn}\t${aaPopup.refCodon||''}\t${r.codon||''}\t${r.refAA||'-'}\t${r.aa||'-'}\t${r.type}`)
                .join('\n');
              copyText(header + lines);
              setAaPopup(null); setAaCopied(true);
              setTimeout(() => setAaCopied(false), 1500);
            }} style={{border:'none',background:'none',cursor:'pointer',
              fontSize:10,color:'var(--teal)',fontWeight:600,padding:'0 4px'}}>
              ✕ Copy & Close
            </button>
          </div>
          <div className="ratio-popup-ref">Ref AA: <b style={{color:'#16a34a'}}>{aaPopup.refAA || '?'}</b></div>
          <div className="ratio-popup-sep"/>
          <div style={{overflowY:'auto', maxHeight:320, fontSize:10, fontFamily:'var(--mono)'}}>
            {['nonsynonymous','synonymous','stop','frameshift'].map(type => {
              const entries = Object.entries(aaPopup.results).filter(([,r])=>r.type===type);
              if (!entries.length) return null;
              const typeColor = {nonsynonymous:'#ef4444',synonymous:'#16a34a',stop:'#7c3aed',frameshift:'#d97706'}[type];
              const typeLabel = {nonsynonymous:'Non-synonymous',synonymous:'Synonymous',stop:'Stop',frameshift:'Frameshift'}[type];
              return (
                <div key={type} style={{marginBottom:8}}>
                  <div style={{color:typeColor,fontWeight:700,marginBottom:3,fontSize:10}}>
                    {typeLabel} ({entries.length})
                  </div>
                  {entries.map(([sid,r]) => (
                    <div key={sid} style={{display:'flex',gap:8,color:'var(--t1)',paddingLeft:8,marginBottom:1,fontSize:10}}>
                      <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sid}</span>
                      <span style={{color:'var(--t2)',fontFamily:'var(--mono)'}}>{r.codon}</span>
                      <span style={{fontWeight:700,color:typeColor,minWidth:14,textAlign:'center'}}>{r.aa||'-'}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="ratio-popup-sep"/>
          <div style={{fontSize:9,color:'var(--t2)',textAlign:'center'}}>
            Click outside to close & copy to clipboard
          </div>
        </div>,
        document.body
      )}
      {/* Copied toast */}
      {aaCopied && ReactDOM.createPortal(
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',
          background:'var(--teal)',color:'#fff',padding:'6px 16px',borderRadius:6,
          fontSize:11,fontWeight:700,zIndex:10000,pointerEvents:'none'}}>
          ✓ Copied to clipboard
        </div>,
        document.body
      )}

      {tip && (
        <div className="vo-tip" style={{ left: tip.x, top: tip.y }}>
          <div><span style={{ color: '#0d9488', fontWeight: 600 }}>{gene.chr}:{tip.rapPos.toLocaleString()}</span> <span style={{ color: '#999', fontSize: 10 }}>local:{tip.pos}</span>
            {tip.isInsCol && <span style={{ color: '#7c3aed', fontSize: 10, marginLeft: 4 }}>ins[{tip.insIdx}]</span>}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span className="vo-tip-badge" style={{ background: tip.regionColor }}>{tip.region}</span>
            {tip.isInsCol ? (
              <>
                inserted base: <b style={{ color: tip.base !== '-' ? (BASE_COL[tip.base] || '#7c3aed') : '#999' }}>{tip.base}</b>
                {tip.fullInsSeq && <span style={{ fontSize: 10, color: '#7c3aed', marginLeft: 4 }}>full: {tip.fullInsSeq}</span>}
              </>
            ) : (
              <>
                ref:<b>{tip.ref}</b> → <b style={{ color: tip.isRef ? '#aaa' : tip.isNoCov ? '#b0ada6' : (BASE_COL[tip.base] || '#333') }}>{tip.base}</b>
                {tip.isNoCov && <span className="vo-tip-nocov">No mapping</span>}
                {tip.isDel && !tip.isNoCov && <span className="vo-tip-nocov">Deletion</span>}
                {!tip.isRef && !tip.isNoCov && !tip.isDel && <span className="vo-tip-alt">ALT</span>}
                {tip.isIns && <span className="vo-tip-ins">INS</span>}
              </>
            )}
          </div>
          {!tip.isInsCol && tip.isNoCov ? (
            <div style={{ fontSize: 10, color: '#b0ada6' }}>No reads mapped to this position</div>
          ) : !tip.isInsCol && tip.counts ? (
            <div style={{ fontSize: 10 }}>depth:{tip.depth}× <span style={{ color: BASE_COL.A }}>A:{tip.counts.A}</span> <span style={{ color: BASE_COL.T }}>T:{tip.counts.T}</span> <span style={{ color: BASE_COL.G }}>G:{tip.counts.G}</span> <span style={{ color: BASE_COL.C }}>C:{tip.counts.C}</span> <span style={{ color: '#94a3b8' }}>D:{tip.counts.del||0}</span> <span style={{ color: '#7c3aed' }}>I:{tip.counts.ins||0}</span></div>
          ) : null}
          {!tip.isInsCol && tip.isIns && tip.insSeqs && (
            <div className="vo-tip-ins-detail">
              <div style={{ fontWeight: 600, color: '#7c3aed', marginBottom: 2 }}>Insertion sequences:</div>
              {Object.entries(tip.insSeqs).sort((a, b) => b[1] - a[1]).map(([seq, count]) => (
                <div key={seq} className="vo-tip-ins-row">
                  <span className="vo-tip-ins-seq">{seq}</span>
                  <span className="vo-tip-ins-count">{count} read{count > 1 ? 's' : ''}</span>
                  <span className="vo-tip-ins-len">{seq.length}bp</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: '#888', borderTop: '1px solid #eee', paddingTop: 2, marginTop: 2 }}>
            {tip.sid} · {tip.hapId}
            {sampleMeta?.[tip.sid]?.variety && (
              <span style={{ marginLeft: 6, color: 'var(--teal)', fontWeight: 500 }}>
                {sampleMeta[tip.sid].variety}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});


const SampleRow = React.memo(function SampleRow({ sid, gene, pileup, cols, groupColor, sampleInsSeqs, padLeft, padRight, hasPad, onHover, onLeave }) {
  return (
    <tr className="vo-sample-row">
      <td className="vo-label vo-sample-label" style={{ borderLeftColor: groupColor }}>
        <span className="vo-sample-id vo-sample-copyable"
          title="Click to copy sample ID"
          onClick={(e) => {
            e.stopPropagation();
            try {
              if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(sid);
              } else {
                const ta = document.createElement('textarea');
                ta.value = sid; ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta); ta.focus(); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
              }
            } catch {}
            e.currentTarget.classList.add('vo-sample-copied');
            setTimeout(() => e.currentTarget.classList.remove('vo-sample-copied'), 900);
          }}
        >{sid}</span>
      </td>
      {hasPad && padLeft > 0 && <td style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft, padding: 0, border: 'none', background: '#f5f4f1' }} />}
      {cols.map((col, i) => {
        if (col.type === 'ins') {
          // Insertion column: show inserted base or gap
          const insSeq = sampleInsSeqs[col.afterPos] || '';
          const insBase = insSeq[col.insIdx] || '';
          const hasBase = insBase && insBase !== '';
          return (
            <td key={`ins-${col.afterPos}-${col.insIdx}`}
              className={`vo-cell vo-ins-col${hasBase ? ' vo-ins-has-base' : ' vo-ins-gap'}`}
              style={hasBase ? { background: '#ede9fe', color: BASE_COL[insBase] || '#7c3aed', fontWeight: 700 } : undefined}
              onMouseEnter={e => onHover(e, sid, col)} onMouseLeave={onLeave}>
              {hasBase ? insBase : '-'}
            </td>
          );
        }
        // Regular ref position column
        const pos = col.pos;
        const ref = (gene.seq[pos - 1] || 'N');
        const info = getDominantAllele(pileup, pos, ref);
        if (info.isNoCov || info.depth === 0)
          return <td key={pos} className="vo-cell vo-gap-line" onMouseEnter={e => onHover(e, sid, col)} onMouseLeave={onLeave} />;
        if (info.isDel)
          return <td key={pos} className="vo-cell vo-gap-line" onMouseEnter={e => onHover(e, sid, col)} onMouseLeave={onLeave} />;
        if (info.isRef && !info.isDel) {
          return <td key={pos} className="vo-cell vo-match" onMouseEnter={e => onHover(e, sid, col)} onMouseLeave={onLeave}>·</td>;
        }
        const bg = BASE_COL[info.base] || '#888';
        return (
          <td key={pos} className="vo-cell vo-alt" style={{ background: bg, color: '#fff' }}
            onMouseEnter={e => onHover(e, sid, col)} onMouseLeave={onLeave}>
            {info.base}
          </td>
        );
      })}
      {hasPad && padRight > 0 && <td style={{ width: padRight, minWidth: padRight, maxWidth: padRight, padding: 0, border: 'none', background: '#f5f4f1' }} />}
    </tr>
  );
});

// ─── Alt Sample Ratio: how many samples have different major allele vs ref ───
const AltSampleRatioRow = React.memo(function AltSampleRatioRow({
  cols, gene, samples, getPileup, sampleInsMap, padLeft, padRight, hasPad,
  getCachedAltRatio, ratioPopup, setRatioPopup
}) {
  if (!gene || !samples?.length) return null;
  return (
    <tr className="vo-ratio-row">
      <td className="vo-label vo-ratio-label">Alt sample</td>
      {hasPad && padLeft > 0 && <td style={{ width:padLeft, padding:0, border:'none', background:'#f5f4f1' }} />}
      {cols.map((col) => {
        if (col.type === 'ins') {
          let hasIns = 0;
          for (const sid of samples) {
            const insSeq = sampleInsMap[sid]?.[col.afterPos] || '';
            if (insSeq.length > col.insIdx) hasIns++;
          }
          const pct = Math.round((hasIns / samples.length) * 100);
          const bg = pct > 50 ? '#f5f3ff' : pct > 5 ? '#faf5ff' : '#fafafa';
          const color = pct > 50 ? '#7c3aed' : pct > 5 ? '#a855f7' : '#d4d4d4';
          return <td key={`ins-${col.afterPos}-${col.insIdx}`} className="vo-cell vo-ratio-cell vo-ins-col" style={{ background:bg, color }}>{hasIns > 0 ? hasIns : '·'}</td>;
        }
        return (
          <AltSampleCell key={col.pos} pos={col.pos} gene={gene} samples={samples}
            getCachedAltRatio={getCachedAltRatio}
            activePopup={ratioPopup} setActivePopup={setRatioPopup} />
        );
      })}
      {hasPad && padRight > 0 && <td style={{ width:padRight, padding:0, border:'none', background:'#f5f4f1' }} />}
    </tr>
  );
});

function AltSampleCell({ pos, gene, samples, getCachedAltRatio, activePopup, setActivePopup }) {
  const d = getCachedAltRatio(pos);
  const { mapped, noCov, altDom, refDom, ref, nSamples } = d;
  if (mapped === 0) return <td className="vo-cell vo-ratio-cell">—</td>;
  const pct   = Math.round(altDom / mapped * 100);
  const bg    = pct > 50 ? '#fef2f2' : pct > 5 ? '#fffbeb' : '#f0fdf4';
  const color = pct > 50 ? '#dc2626' : pct > 5 ? '#d97706' : '#16a34a';
  const isOpen = activePopup?.pos === pos && activePopup?.type === 'sample';
  const [hovered, setHovered] = React.useState(false);

  return (
    <td className="vo-cell vo-ratio-cell"
      style={{ background: (hovered||isOpen) ? '#dbeafe' : bg, color, cursor:'pointer',
        outline: (hovered||isOpen) ? '2px solid #2563eb' : 'none',
        outlineOffset: '-2px', transition:'background .1s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); if (isOpen) setActivePopup(null); }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (isOpen) { setActivePopup(null); return; }
        const rect = e.currentTarget.getBoundingClientRect();
        setActivePopup({ type:'sample', pos, x: rect.left + rect.width/2, y: rect.top - 4 });
      }}>
      {altDom > 0 ? altDom : '0'}
      {isOpen && ReactDOM.createPortal(
        <div className="ratio-popup" style={{
          left: Math.max(10, Math.min(activePopup.x - 90, window.innerWidth - 200)),
          top:  Math.max(10, activePopup.y - 130), position:'fixed',
        }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="ratio-popup-hd">{gene.chr}:{localToRapdb(pos,gene.offset).toLocaleString()} <span style={{color:'#999'}}>local:{pos}</span></div>
          <div className="ratio-popup-ref">ref: <b style={{color:BASE_COL[ref]}}>{ref}</b></div>
          <div className="ratio-popup-sep"/>
          <div className="ratio-popup-row"><span>Total samples:</span><b>{nSamples}</b></div>
          <div className="ratio-popup-row"><span>Mapped:</span><b>{mapped}</b></div>
          <div className="ratio-popup-row"><span>No coverage:</span><b>{noCov}</b></div>
          <div className="ratio-popup-sep"/>
          <div className="ratio-popup-row"><span>Ref-dominant:</span><b style={{color:'#16a34a'}}>{refDom}</b></div>
          <div className="ratio-popup-row"><span>Alt-dominant:</span><b style={{color:'#dc2626'}}>{altDom}</b></div>
          {(d.baseTotals?.gap||0) > 0 && <div className="ratio-popup-row"><span style={{color:'#94a3b8'}}>Gap(no map):</span><b>{Math.round((d.baseTotals.gap||0)/10)}</b></div>}
          <div className="ratio-popup-pct" style={{color}}>{altDom}/{mapped} ({pct}%)</div>
        </div>,
        document.body
      )}
    </td>
  );
}

const AltReadRatioRow = React.memo(function AltReadRatioRow({
  cols, gene, samples, getPileup, padLeft, padRight, hasPad,
  getCachedAltRatio, ratioPopup, setRatioPopup
}) {
  if (!gene || !samples?.length) return null;
  return (
    <tr className="vo-ratio-row">
      <td className="vo-label vo-ratio-label">Alt read</td>
      {hasPad && padLeft > 0 && <td style={{ width:padLeft, padding:0, border:'none', background:'#f5f4f1' }} />}
      {cols.map((col) => {
        if (col.type === 'ins') return (
          <td key={`ins-${col.afterPos}-${col.insIdx}`} className="vo-cell vo-ratio-cell vo-ins-col" style={{color:'#d4d4d4'}}>·</td>
        );
        return (
          <AltReadCell key={col.pos} pos={col.pos} gene={gene} samples={samples}
            getCachedAltRatio={getCachedAltRatio}
            activePopup={ratioPopup} setActivePopup={setRatioPopup} />
        );
      })}
      {hasPad && padRight > 0 && <td style={{ width:padRight, padding:0, border:'none', background:'#f5f4f1' }} />}
    </tr>
  );
});

function AltReadCell({ pos, gene, samples, getCachedAltRatio, activePopup, setActivePopup }) {
  const d = getCachedAltRatio(pos);
  const { altPct, baseTotals, totalSamples, noCov, ref, refCount, altCount, nSamples } = d;
  if (!totalSamples) return <td className="vo-cell vo-ratio-cell">—</td>;
  const bg    = altPct > 50 ? '#fef2f2' : altPct > 10 ? '#fffbeb' : '#f0fdf4';
  const color = altPct > 50 ? '#dc2626' : altPct > 10 ? '#d97706' : '#16a34a';
  const isOpen = activePopup?.pos === pos && activePopup?.type === 'read';
  const [hovered, setHovered] = React.useState(false);

  return (
    <td className="vo-cell vo-ratio-cell"
      style={{ background: (hovered||isOpen) ? '#dbeafe' : bg, color, cursor:'pointer',
        outline: (hovered||isOpen) ? '2px solid #2563eb' : 'none',
        outlineOffset: '-2px', transition:'background .1s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); if (isOpen) setActivePopup(null); }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (isOpen) { setActivePopup(null); return; }
        const rect = e.currentTarget.getBoundingClientRect();
        setActivePopup({ type:'read', pos, x: rect.left + rect.width/2, y: rect.top - 4 });
      }}>
      {altPct}%
      {isOpen && ReactDOM.createPortal(
        <div className="ratio-popup" style={{
          left: Math.max(10, Math.min(activePopup.x - 90, window.innerWidth - 200)),
          top:  Math.max(10, activePopup.y - 190), position:'fixed',
        }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="ratio-popup-hd">{gene.chr}:{localToRapdb(pos,gene.offset).toLocaleString()} <span style={{color:'#999'}}>local:{pos}</span></div>
          <div className="ratio-popup-ref">ref: <b style={{color:BASE_COL[ref]}}>{ref}</b></div>
          <div className="ratio-popup-sep"/>
          <div className="ratio-popup-row"><span>Total samples:</span><b>{nSamples}</b></div>
          <div className="ratio-popup-row"><span>Mapped:</span><b>{totalSamples}</b></div>
          <div className="ratio-popup-row"><span>No coverage:</span><b>{noCov}</b></div>
          <div className="ratio-popup-sep"/>
          <div className="ratio-popup-row">
            <span style={{color:BASE_COL.A}}>A:</span><b>{(baseTotals.A||0).toLocaleString()}</b>
            <span style={{color:BASE_COL.T,marginLeft:6}}>T:</span><b>{(baseTotals.T||0).toLocaleString()}</b>
          </div>
          <div className="ratio-popup-row">
            <span style={{color:BASE_COL.G}}>G:</span><b>{(baseTotals.G||0).toLocaleString()}</b>
            <span style={{color:BASE_COL.C,marginLeft:6}}>C:</span><b>{(baseTotals.C||0).toLocaleString()}</b>
          </div>
          <div className="ratio-popup-row">
            <span style={{color:'#94a3b8'}}>Del:</span><b>{(baseTotals.del||0).toLocaleString()}</b>
            <span style={{color:'#7c3aed',marginLeft:6}}>Ins:</span><b>{(baseTotals.ins||0).toLocaleString()}</b>
          </div>
          <div className="ratio-popup-sep"/>
          <div className="ratio-popup-row">
            <span>Ref reads:</span><b>{(refCount||0).toLocaleString()}</b>
            <span style={{marginLeft:6}}>Alt reads:</span><b style={{color:'#dc2626'}}>{(altCount||0).toLocaleString()}</b>
          </div>
          <div className="ratio-popup-pct" style={{color}}>{altPct}% alt reads</div>
        </div>,
        document.body
      )}
    </td>
  );
}


// ─── CanvasLabelColSpacer: invisible div to preserve td height ─────────────
const CanvasLabelColSpacer = React.memo(function CanvasLabelColSpacer({ groups, rowH }) {
  const h = (groups||[]).reduce((acc, g) => acc + 22 + g.vis.length * rowH, 0);
  return <div style={{ height: h, pointerEvents:'none', visibility:'hidden' }} />;
});

// ─── CanvasLabelCol ───────────────────────────────────────────────────────────
const CanvasLabelCol = React.memo(function CanvasLabelCol({ groups, sampleMeta, rowH }) {
  const showVariety = rowH > 20;  // rowH >=28 → 2-line layout
  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {(groups||[]).map(group => (
        <React.Fragment key={group.id}>
          <div style={{
            height:22, display:'flex', alignItems:'center', paddingLeft:5,
            background:group.color+'12', fontSize:10, fontWeight:700, color:group.color,
            fontFamily:'var(--mono)', whiteSpace:'nowrap', overflow:'hidden',
            borderBottom:'1px solid var(--bg3)',
          }}>
            {group.label}
          </div>
          {group.vis.map(sid => {
            const variety = sampleMeta?.[sid]?.variety;
            return (
              <div key={sid} style={{
                height:rowH, display:'flex',
                flexDirection: showVariety ? 'column' : 'row',
                justifyContent: showVariety ? 'center' : 'flex-start',
                alignItems: showVariety ? 'flex-start' : 'center',
                paddingLeft:6, paddingTop: showVariety ? 2 : 0,
                borderLeft:`3px solid ${group.color}`,
                fontFamily:'var(--mono)',
                whiteSpace:'nowrap', overflow:'hidden',
                borderBottom:'1px solid var(--bg3)', boxSizing:'border-box',
              }}>
                <span style={{fontSize:10, color:'#555', overflow:'hidden', textOverflow:'ellipsis', maxWidth:116, lineHeight:1.1}}>{sid}</span>
                {showVariety && (
                  <span style={{fontSize:9, color:'var(--t2)', overflow:'hidden',
                    textOverflow:'ellipsis', maxWidth:116, lineHeight:1.1,
                    fontFamily:'var(--sans)', fontStyle: variety ? 'normal' : 'italic',
                    opacity: variety ? 1 : 0.4}}>
                    {variety || '—'}
                  </span>
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
});

// ─── CanvasSampleRows (Gemini-recommended layout) ──────────────────────────
// Rendering based on visibleCols + position:absolute; left:padLeft
// → Physically identical coordinates to DOM <th> → zero misalignment
// → No need to subscribe to scroll events → browser-native scroll handles movement
const BASE_CC = { A:'#1d6fba', T:'#15803d', G:'#b35a00', C:'#c41c1c' };
const GROUP_H_C = 22;
const COL_W_C = 24;

function CanvasSampleRows({
  groups, gene, visibleCols, msaColumnsFromParent, padLeft,
  totalW, viewW,
  positionData, sampleIdxMap, sampleList, sampleInsMap,
  dragSelection, scrollRef, onHover, onLeave, isPanning,
  rowH = 20,
}) {
  const canvasRef = useRef(null);

  const pdMapRef = useRef(new Map());
  useEffect(() => {
    const m = new Map();
    (positionData||[]).forEach(pd => m.set(pd.pos, pd));
    pdMapRef.current = m;
  }, [positionData]);

  const layoutRef = useRef([]);
  const totalHRef = useRef(0);
  useEffect(() => {
    const rows = []; let y = 0;
    for (const g of (groups||[])) {
      rows.push({ type:'group', y, color:g.color }); y += GROUP_H_C;
      for (const sid of g.vis) { rows.push({ type:'sample', y, sid, color:g.color }); y += rowH; }
    }
    layoutRef.current = rows;
    totalHRef.current = y;
  }, [groups, rowH]);

  function getAllele(pd, si, refBase) {
    if (!pd) return refBase;
    if (pd.enc !== undefined) {
      if (si < 0 || si >= pd.enc.length) return refBase;
      const ch = pd.enc[si];
      if (ch==='0') return refBase; if (ch==='-') return '-';
      const ai = parseInt(ch)-1;
      return ai<(pd.alt||[]).length ? pd.alt[ai] : refBase;
    }
    if (pd.alleles) { const s2=sampleList?.[si]; return s2?(pd.alleles[s2]??refBase):refBase; }
    return refBase;
  }

  function drawFrame() {
    const canvas = canvasRef.current;
    if (!canvas || !gene || !visibleCols?.length) return;
    // Always use visibleCols (perfectly in sync with header)
    const drawCols = visibleCols;

    const dpr = window.devicePixelRatio || 1;
    const W = drawCols.length * COL_W_C;
    const H = totalHRef.current || 1;
    if (canvas.width!==Math.round(W*dpr)||canvas.height!==Math.round(H*dpr)) {
      canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
      canvas.style.width=W+'px'; canvas.style.height=H+'px';
    }
    // Update canvas position dynamically as well
    canvas.style.left = padLeft + 'px';

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);

    const sRows = layoutRef.current.filter(r=>r.type==='sample');

    // Group background
    for (const row of layoutRef.current) {
      if (row.type==='group') {
        ctx.fillStyle=row.color+'08';
        ctx.fillRect(0,row.y,W,GROUP_H_C);
      }
    }

    // Data batching
    const bk={}, tx=[], dels=[];
    for (let i=0; i<drawCols.length; i++) {
      const col = drawCols[i];
      const x = i * COL_W_C;
      for (const row of sRows) {
        const {y,sid} = row;
        const si = sampleIdxMap?.[sid]??(sampleList||[]).indexOf(sid);
        if (col.type==='ins') {
          const b=(sampleInsMap?.[sid]?.[col.afterPos]||'')[col.insIdx]||'';
          if(b){if(!bk.ins)bk.ins=[];bk.ins.push([x,y,COL_W_C-1,rowH-1]);
            tx.push({t:b,x:x+COL_W_C/2,y:y+rowH/2,c:BASE_CC[b]||'#7c3aed'});}
          continue;
        }
        const ref=gene.seq[col.pos-1]||'N';
        const pd=pdMapRef.current.get(col.pos);
        const a=getAllele(pd,si,ref);
        if(a==='-'){if(!bk.n)bk.n=[];bk.n.push([x,y,COL_W_C-1,rowH-1]);}
        else if(a==='D'){dels.push([x,y]);}
        else if(a===ref){tx.push({t:'·',x:x+COL_W_C/2,y:y+rowH/2,c:'#bbb'});}
        else{
          const base=a.includes('+')?a[0]:a;
          if(!bk[base])bk[base]=[];bk[base].push([x,y,COL_W_C-1,rowH-1]);
          if(COL_W_C>=14)tx.push({t:base,x:x+COL_W_C/2,y:y+rowH/2,c:'#fff'});
        }
      }
    }
    const BG={n:'#e2e0db',A:'#1d6fba',T:'#15803d',G:'#b35a00',C:'#c41c1c',ins:'#ede9fe'};
    for(const[k,list] of Object.entries(bk)){ctx.fillStyle=BG[k]||'#888';for(const r of list)ctx.fillRect(r[0],r[1],r[2],r[3]);}
    ctx.fillStyle='#c8c5be'; for(const[x,y] of dels)ctx.fillRect(x,y,COL_W_C-1,rowH-1);
    ctx.strokeStyle='#9a9690';ctx.lineWidth=1;
    for(const[x,y] of dels){ctx.beginPath();ctx.moveTo(x+3,y+rowH/2);ctx.lineTo(x+COL_W_C-4,y+rowH/2);ctx.stroke();}
    tx.sort((a,b)=>a.c<b.c?-1:1);
    ctx.font=`11px "JetBrains Mono",monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
    let lc='';
    for(const t of tx){if(t.c!==lc){ctx.fillStyle=t.c;lc=t.c;}ctx.fillText(t.t,t.x,t.y);}

    // drag highlight
    if (dragSelection) {
      const s=Math.min(dragSelection.startPos,dragSelection.endPos);
      const e=Math.max(dragSelection.startPos,dragSelection.endPos);
      let x1=-1, x2=-1;
      for(let i=0;i<drawCols.length;i++){
        const col=drawCols[i]; if(col.type!=='ref') continue;
        if(col.pos>=s&&x1<0) x1=i*COL_W_C;
        if(col.pos>=e){x2=(i+1)*COL_W_C; break;}
      }
      if(x1>=0){
        if(x2<0) x2=drawCols.length*COL_W_C;
        ctx.fillStyle='rgba(37,99,235,0.10)';ctx.fillRect(x1,0,x2-x1,totalHRef.current);
        ctx.strokeStyle='rgba(37,99,235,0.45)';ctx.lineWidth=1.5;ctx.strokeRect(x1,0,x2-x1,totalHRef.current);
      }
    }
    ctx.restore();
  }

  // Draw when visibleCols / groups / gene / padLeft change
  // padLeft is applied directly to canvas.style.left, so must be a dep
  useEffect(() => { drawFrame(); }, [visibleCols, groups, dragSelection, gene, padLeft]); // eslint-disable-line
  // Canvas is position:absolute+padLeft → native scroll handles movement
  // No need to subscribe to scroll events — drawFrame is called only when visibleCols changes
  // No onMouseDown on Canvas needed (React SyntheticEvent bubbles by default)
  // vo-scroll's handleMouseDown handles both shift+drag and panning

  // Mouse hover: simple computation based on visibleCols
  const handleMouseMove = useCallback((e) => {
    if (isPanning) return;
    if(!gene||!visibleCols?.length) return;
    const rect=canvasRef.current?.getBoundingClientRect(); if(!rect) return;
    const y = e.clientY - rect.top;
    const row=layoutRef.current.find(r=>y>=r.y&&y<r.y+(r.type==='group'?GROUP_H_C:rowH));
    if(!row||row.type!=='sample'){onLeave();return;}
    const x = e.clientX - rect.left;
    const i = Math.max(0, Math.min(Math.floor(x / COL_W_C), visibleCols.length - 1));
    const col = visibleCols[i];
    if(col) onHover(e,row.sid,col); else onLeave();
  },[gene,visibleCols,onHover,onLeave,isPanning,rowH]); // eslint-disable-line

  return (
    <canvas
      ref={canvasRef}
      draggable={false}
      style={{
        display:'block',
        position:'absolute',
        left: padLeft,
        top: 0,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={onLeave}
    />
  );
}


export default GenomeViewCanvas;
