import React, { useMemo, useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import ReactDOM from 'react-dom';
import { HAP_COLORS, BASE_COL } from '../utils/constants.js';
import { getDominantAllele, buildMsaColumns, getAlleleForSample } from '../utils/haplotype.js';
import { classifyPosition, REGION_COL, REGION_LBL, buildAnnotSegments } from '../utils/annotation.js';
import AnnotationRow from './AnnotationRow.jsx';
import RefCell from './RefCell.jsx';
import { localToRapdb } from '../utils/positionUtils.js';

const COL_W = 24;
const LABEL_W = 130;
const BUFFER = 30;

const GenomeView = forwardRef(function GenomeView(
  { gene, hapData, regionPositionData, shownSamples, sampleHapMap, getPileup,
    viewRegion = 'all', viewFlags = { identical: true, snp: true, indel: true, gap: true },
    samples = [],
    posMode = 'rapdb',
    gotoTarget = null,
    onColumnDragEnd = null,
    sampleIdxMap = {},
    sampleList = [],
  }, ref
) {
  const scrollRef = useRef(null);
  const minimapRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollLeftRef = useRef(0);
  const scrollRafRef = useRef(null);
  const isDraggingRef = useRef(false);
  const [viewW, setViewW] = useState(800);
  const [dragSelection, setDragSelection] = useState(null);
  const colDragRef = useRef({ active: false, startPos: null, endPos: null });

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; setScrollLeft(0); }, [gene, viewRegion, viewFlags]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const m = () => setViewW(el.clientWidth - LABEL_W);
    m(); const ro = new ResizeObserver(m); ro.observe(el); return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    scrollLeftRef.current = scrollRef.current.scrollLeft;
    if (isDraggingRef.current) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollLeft(scrollLeftRef.current);
    });
  }, []);

  // Click+drag to scroll horizontally
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0 });

  const clientXToPos = useCallback((clientX) => {
    if (!scrollRef.current || !msaColumnsRef.current?.length) return null;
    const rect = scrollRef.current.getBoundingClientRect();
    const relX = clientX - rect.left - LABEL_W + scrollRef.current.scrollLeft;
    const colIdx = Math.max(0, Math.floor(relX / COL_W));
    const cols = msaColumnsRef.current;
    const col = cols[Math.min(colIdx, cols.length - 1)];
    return col ? (col.type === 'ref' ? col.pos : col.afterPos) : null;
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    if (e.clientX - rect.left < LABEL_W) return;
    if (e.shiftKey && onColumnDragEnd) {
      const pos = clientXToPos(e.clientX);
      colDragRef.current = { active: true, startPos: pos, endPos: pos };
      setDragSelection(pos ? { startPos: pos, endPos: pos } : null);
      e.preventDefault();
    } else {
      isDraggingRef.current = true;
      dragRef.current = { active: true, startX: e.clientX, startScroll: scrollRef.current.scrollLeft };
      scrollRef.current.style.cursor = 'grabbing';
      e.preventDefault();
    }
  }, [onColumnDragEnd, clientXToPos]);

  useEffect(() => {
    const onMove = (e) => {
      if (colDragRef.current.active) {
        const pos = clientXToPos(e.clientX);
        if (pos) { colDragRef.current.endPos = pos; setDragSelection({ startPos: colDragRef.current.startPos, endPos: pos }); }
        return;
      }
      const d = dragRef.current;
      if (!d.active || !scrollRef.current) return;
      scrollRef.current.scrollLeft = d.startScroll + (d.startX - e.clientX);
    };
    const onUp = () => {
      if (colDragRef.current.active) {
        const { startPos, endPos } = colDragRef.current;
        colDragRef.current = { active: false, startPos: null, endPos: null };
        if (startPos && endPos && onColumnDragEnd) onColumnDragEnd(Math.min(startPos, endPos), Math.max(startPos, endPos));
        return;
      }
      if (dragRef.current.active) {
        dragRef.current.active = false;
        isDraggingRef.current = false;
        if (scrollRef.current) {
          scrollRef.current.style.cursor = 'grab';
          setScrollLeft(scrollLeftRef.current);
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [onColumnDragEnd, clientXToPos]);

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

  // Set of all variant positions for fast lookup
  const regionPosSet = useMemo(() => new Set(regionPositionData.map(pd => pd.pos)), [regionPositionData]);

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

  const { visibleCols, padLeft, padRight } = useMemo(() => {
    const total = msaColumns.length;
    if (!total) return { visibleCols: [], padLeft: 0, padRight: 0 };
    if (total * COL_W <= viewW + LABEL_W) {
      return { visibleCols: msaColumns, padLeft: 0, padRight: 0 };
    }
    const si = Math.max(0, Math.floor(scrollLeft / COL_W) - BUFFER);
    const ei = Math.min(total - 1, Math.ceil((scrollLeft + viewW + LABEL_W) / COL_W) + BUFFER);
    const vis = msaColumns.slice(si, ei + 1);
    const pL = si * COL_W;
    const pR = totalW - pL - vis.length * COL_W;
    return { visibleCols: vis, padLeft: pL, padRight: Math.max(0, pR) };
  }, [msaColumns, scrollLeft, viewW, totalW]);

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

  // pdMap for AA change lookup
  const pdMap = useMemo(() => {
    const m = new Map();
    regionPositionData.forEach(pd => m.set(pd.pos, pd));
    return m;
  }, [regionPositionData]);

  const handleHover = useCallback((e, sid, col) => {
    if (!gene) return;
    if (col.type === 'ins') {
      const insSeq = sampleInsMap[sid]?.[col.afterPos] || '';
      const insBase = insSeq[col.insIdx] || '-';
      setTip({
        x: Math.min(e.clientX + 14, window.innerWidth - 230),
        y: Math.min(e.clientY - 10, window.innerHeight - 200),
        pos: col.afterPos, rapPos: localToRapdb(col.afterPos, gene.offset), ref: '-',
        base: insBase, isRef: false, depth: 0, counts: null, isDel: false, isIns: true,
        isNoCov: false, insSeqs: null, sid, hapId: sampleHapMap[sid] || '?',
        region: 'Insertion', regionColor: '#7c3aed',
        isInsCol: true, insIdx: col.insIdx, fullInsSeq: insSeq, aaChange: null,
      });
      return;
    }
    const pos = col.pos;
    const pileup = getPileup(gene.id, sid);
    const ref = (gene.seq[pos - 1] || 'N');
    const info = getDominantAllele(pileup, pos, ref);
    const rt = regionCache[pos] || classifyPosition(pos, gene);
    const pd = pdMap.get(pos);
    let aaChange = null;
    if (pd?.aaChange) {
      const base = info.base;
      if (pd.aaChange.frameshift) aaChange = { text: 'Frameshift', type: 'frameshift' };
      else if (base && base !== ref && base !== '-' && base !== 'D' && pd.aaChange.alts?.[base]) {
        const a = pd.aaChange.alts[base];
        aaChange = { text: `${pd.aaChange.ref_aa} → ${a.aa}`, type: a.type, codon: `${pd.aaChange.ref_codon} → ${a.codon}` };
      }
    }
    setTip({
      x: Math.min(e.clientX + 14, window.innerWidth - 230),
      y: Math.min(e.clientY - 10, window.innerHeight - 200),
      pos, rapPos: localToRapdb(pos, gene.offset), ref, base: info.base, isRef: info.isRef,
      depth: info.depth, counts: info.counts, isDel: info.isDel, isIns: info.isIns,
      isNoCov: info.isNoCov, insSeqs: info.insSeqs, sid, hapId: sampleHapMap[sid] || '?',
      region: REGION_LBL[rt] || rt, regionColor: REGION_COL[rt],
      isInsCol: false, aaChange,
    });
  }, [gene, getPileup, sampleHapMap, regionCache, sampleInsMap, pdMap]);

  const handleMinimapClick = useCallback((e) => {
    if (!scrollRef.current || !minimapRef.current) return;
    const rect = minimapRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    scrollRef.current.scrollLeft = frac * totalW - viewW / 2;
  }, [totalW, viewW]);

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
  const hasInsertions = Object.keys(sampleInsMap).some(sid => Object.keys(sampleInsMap[sid]).length > 0);

  // Minimap annotation features
  const targetMrnaIds = new Set();
  gene.features.forEach(f => { if (f.type === 'mRNA' && f.attrs?.Locus_id === gene.id) targetMrnaIds.add(f.attrs.ID); });
  const cdsFeatures = gene.features.filter(f => (f.type === 'CDS' || f.type === 'exon') && f.attrs?.Parent && targetMrnaIds.has(f.attrs.Parent));
  const utrFeatures = gene.features.filter(f => (f.type === 'five_prime_UTR' || f.type === 'three_prime_UTR') && f.attrs?.Parent && targetMrnaIds.has(f.attrs.Parent));
  const neighborGenes = gene.features.filter(f => f.type === 'gene' && f.attrs?.ID !== gene.id);

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
    return { left: `${s * 100}%`, width: `${Math.max((e - s) * 100, 0.3)}%` };
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
      </div>

      {/* Minimap — annotation mapped to column positions */}
      {showMinimap && (
        <div className="fr-minimap" ref={minimapRef} onClick={handleMinimapClick}>
          <div className="fr-mm-bound fr-mm-bound-l">{showAll ? (allPositions[0] || 1) : `#1`}</div>
          <div className="fr-mm-bound fr-mm-bound-r">{showAll ? (allPositions[allPositions.length - 1] || '').toLocaleString() : `#${allPositions.length.toLocaleString()}`}</div>

          {/* Gene body */}
          <div className="fr-mm-genebody" style={mmMapRangeFrac(gls, gle)} />
          {/* Intron line */}
          <div className="fr-mm-intron" style={mmMapRangeFrac(gls, gle)} />

          {/* CDS blocks */}
          {cdsFeatures.map((f, i) => (
            <div key={`c${i}`} className="fr-mm-cds" style={mmMapRangeFrac(f.start, f.end)} />
          ))}
          {/* UTR blocks */}
          {utrFeatures.map((f, i) => (
            <div key={`u${i}`} className="fr-mm-utr" style={mmMapRangeFrac(f.start, f.end)} />
          ))}
          {/* Neighbor genes */}
          {neighborGenes.map((f, i) => (
            <div key={`n${i}`} className="fr-mm-neighbor" style={mmMapRangeFrac(f.start, f.end)}>
              <span className="fr-mm-ng-name">{(f.attrs?.Name || f.attrs?.ID || '').split(',')[0]}</span>
            </div>
          ))}
          {/* Gene label */}
          <div className="fr-mm-gene-label" style={{ left: `${mmMapBpToFrac((gls + gle) / 2) * 100}%` }}>
            {gene.strand === '+' ? '→' : '←'} {gene.sym}
          </div>
          {/* Viewport */}
          <div className="fr-mm-view" style={{
            left: `${(scrollLeft / totalW) * 100}%`,
            width: `${Math.max((viewW / totalW) * 100, 0.5)}%`
          }} />
          {/* Current position */}
          <div className="fr-mm-pos">
            {(() => {
              const idx = Math.max(0, Math.min(msaColumns.length - 1, Math.round(scrollLeft / COL_W)));
              const col = msaColumns[idx];
              const pos = col ? (col.type === 'ref' ? col.pos : col.afterPos) : 1;
              return `${gene.chr}:${(pos + gene.offset).toLocaleString()}`;
            })()}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="vo-scroll" ref={scrollRef} onScroll={handleScroll} onMouseDown={handleMouseDown}
        onMouseLeave={() => { setTip(null); dragRef.current.active = false; }}
        style={{ cursor: 'grab' }}>
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
                <span className="vo-corner-gene">{gene.sym}</span>
                <span className="vo-corner-n">{msaColumns.length.toLocaleString()} col{hasInsertions ? ` (${allPositions.length}bp+ins)` : showAll ? ' bp' : ' var'}</span>
              </th>
              {hasPad && padLeft > 0 && <th style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft, padding: 0, border: 'none', background: '#f5f4f1' }} />}
              {visibleCols.map((col, i) => {
                if (col.type === 'ins') {
                  return <th key={`ins-${col.afterPos}-${col.insIdx}`} className="vo-pos-th vo-ins-pos-th" title={`Insertion after ${col.afterPos}, idx ${col.insIdx}`}><span className="vo-pos-num vo-ins-pos-num">·</span></th>;
                }
                return (
                  <th key={col.pos} className="vo-pos-th vo-pos-clickable" title={`Local: ${col.pos} | RAP-DB: ${(col.pos + gene.offset).toLocaleString()} — Click to copy`}
                    onClick={() => { navigator.clipboard.writeText(String(col.pos)); const el = document.getElementById(`pos-${col.pos}`); if (el) { el.classList.add('vo-pos-copied'); setTimeout(() => el.classList.remove('vo-pos-copied'), 600); } }}>
                    <span id={`pos-${col.pos}`} className="vo-pos-num">{posMode === "rapdb" ? localToRapdb(col.pos, gene.offset).toLocaleString() : col.pos}</span>
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
            {/* Alt sample ratio (how many samples have different major allele) */}
            <AltSampleRatioRow cols={visibleCols} gene={gene} samples={samples} getPileup={getPileup} sampleInsMap={sampleInsMap}
              padLeft={hasPad ? padLeft : 0} padRight={hasPad ? padRight : 0} hasPad={hasPad} />
            {/* Alt read ratio (total alt reads / total reads) */}
            <AltReadRatioRow cols={visibleCols} gene={gene} samples={samples} getPileup={getPileup}
              padLeft={hasPad ? padLeft : 0} padRight={hasPad ? padRight : 0} hasPad={hasPad} />
          </thead>
        </table>
        </div>
      </div>
      {/* Sample rows: outside the scroll container, kept in sync with thead via CSS transform */}
      <div style={{ display: 'flex', overflow: 'hidden', flexShrink: 0 }}>
        {/* Labels: fixed */}
        <div style={{
          width: LABEL_W, minWidth: LABEL_W, flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg1)',
          zIndex: 3,
        }}>
          <SampleLabels groups={groups} />
        </div>
        {/* Canvas: synced via the scroll event, maintains viewW size */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SampleCanvasCell
            key={gene.id}
            groups={groups}
            gene={gene}
            msaColumns={msaColumns}
            totalW={totalW}
            viewW={viewW}
            positionData={regionPositionData}
            sampleIdxMap={sampleIdxMap}
            sampleList={sampleList}
            sampleInsMap={sampleInsMap}
            scrollRef={scrollRef}
            scrollLeftRef={scrollLeftRef}
            onHover={handleHover}
            onLeave={() => setTip(null)}
            dragSelection={dragSelection}
          />
        </div>
      </div>

      {/* Tooltip */}
      {tip && (
        <div className="vo-tip" style={{ left: tip.x, top: tip.y }}>
          <div>
            <span style={{ color: '#0d9488', fontWeight: 600 }}>{gene.chr}:{tip.rapPos.toLocaleString()}</span>
            {' '}<span style={{ color: '#999', fontSize: 10 }}>local:{tip.pos}</span>
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
          {tip.aaChange && (
            <div className={`vo-tip-aa vo-tip-aa-${tip.aaChange.type}`}>
              {tip.aaChange.type==='frameshift'?'⚠ Frameshift':tip.aaChange.type==='synonymous'?`✓ ${tip.aaChange.text}`:tip.aaChange.type==='stop_gained'?`⛔ ${tip.aaChange.text}`:`★ ${tip.aaChange.text}`}
              {tip.aaChange.codon&&<span style={{fontSize:10,color:'#94a3b8',marginLeft:4}}>({tip.aaChange.codon})</span>}
            </div>
          )}
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
          <div style={{ fontSize: 10, color: '#888', borderTop: '1px solid #eee', paddingTop: 2, marginTop: 2 }}>{tip.sid} · {tip.hapId}</div>
        </div>
      )}
      {dragSelection && onColumnDragEnd && (
        <div className="vo-drag-hint">
          <span>⇔ <b>{localToRapdb(dragSelection.startPos,gene.offset).toLocaleString()}</b> – <b>{localToRapdb(dragSelection.endPos,gene.offset).toLocaleString()}</b></span>
          <span style={{color:'#94a3b8',marginLeft:6,fontSize:11}}>release → Marker Design</span>
        </div>
      )}
    </div>
  );
});

export default GenomeView;

// ─── SampleLabels: sample-name labels (sticky left) ────────────────────────
const ROW_H_S = 20;
const GROUP_H_S = 22;

const SampleLabels = React.memo(function SampleLabels({ groups }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {(groups || []).map(group => (
        <React.Fragment key={group.id}>
          <div style={{
            height: GROUP_H_S, display: 'flex', alignItems: 'center',
            paddingLeft: 5, background: group.color + '12',
            fontSize: 11, fontWeight: 700, color: group.color,
            fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden',
            borderBottom: '1px solid var(--bg3)',
          }}>
            {group.label}
            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 400, color: '#888' }}>
              {group.vis.length} · {group.nSnp||0}snp
              {group.nGap ? ` · ${group.nGap}gap` : ''}{group.nIns ? ` · ${group.nIns}ins` : ''}
            </span>
          </div>
          {group.vis.map(sid => (
            <div key={sid} style={{
              height: ROW_H_S, display: 'flex', alignItems: 'center',
              paddingLeft: 6, paddingRight: 4,
              borderLeft: `3px solid ${group.color}`,
              fontSize: 10, color: '#555',
              fontFamily: 'var(--mono)',
              whiteSpace: 'nowrap', overflow: 'hidden',
              borderBottom: '1px solid var(--bg3)',
              boxSizing: 'border-box',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{sid}</span>
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
});

// ─── SampleCanvasCell: Worker OffscreenCanvas wrapper ──────────────────────
const COL_W_C = 24;
const ROW_H_C = 20;
const GROUP_H_C = 22;

const BASE_C = { A:'#1d6fba', T:'#15803d', G:'#b35a00', C:'#c41c1c' };

function SampleCanvasCell({
  groups, gene, msaColumns, totalW, viewW,
  positionData, sampleIdxMap, sampleList, sampleInsMap,
  scrollRef, scrollLeftRef, onHover, onLeave, dragSelection,
}) {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const rafRef = useRef(null);
  const initRef = useRef(false);

  // pdMap
  const pdMapRef = useRef(new Map());
  useEffect(() => {
    const m = new Map();
    (positionData || []).forEach(pd => m.set(pd.pos, pd));
    pdMapRef.current = m;
  }, [positionData]);

  // layout
  const layoutRef = useRef([]);
  const totalHRef = useRef(0);
  useEffect(() => {
    const rows = [];
    let y = 0;
    for (const g of (groups || [])) {
      rows.push({ type: 'group', y, color: g.color });
      y += GROUP_H_C;
      for (const sid of g.vis) {
        rows.push({ type: 'sample', y, sid, color: g.color });
        y += ROW_H_C;
      }
    }
    layoutRef.current = rows;
    totalHRef.current = y;
  }, [groups]);

  // allele lookup
  function getAllele(pd, si, refBase) {
    if (!pd) return refBase;
    if (pd.enc !== undefined) {
      if (si < 0 || si >= pd.enc.length) return refBase;
      const ch = pd.enc[si];
      if (ch === '0') return refBase;
      if (ch === '-') return '-';
      const ai = parseInt(ch) - 1;
      return ai < (pd.alt||[]).length ? pd.alt[ai] : refBase;
    }
    if (pd.alleles) {
      const sid2 = sampleList[si];
      return sid2 ? (pd.alleles[sid2] ?? refBase) : refBase;
    }
    return refBase;
  }

  // drawFrame: translateX wrapper handles scroll
  // Canvas draws from x=0 across totalW but only processes the visible range
  function drawFrame(sl) {
    const canvas = canvasRef.current;
    if (!canvas || !gene || !msaColumns?.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = totalW || msaColumns.length * COL_W_C;
    const H = totalHRef.current || 1;

    // Canvas = viewW wide, ctx.translate(-sl) reflects scroll
    const vw = scrollRef?.current?.clientWidth || viewW || 800;
    const canvasW = Math.max(vw, 100);
    if (canvas.width !== Math.round(canvasW * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(canvasW * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = canvasW + 'px';
      canvas.style.height = H + 'px';
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasW, H);
    ctx.translate(-sl, 0);  // scroll offset
    ctx.font = '11px "JetBrains Mono",monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const startCI = Math.max(0, Math.floor(sl / COL_W_C) - 5);
    const endCI = Math.min(msaColumns.length - 1, Math.ceil((sl + canvasW) / COL_W_C) + 5);

    for (const row of layoutRef.current) {
      const { y } = row;
      if (y + ROW_H_C < 0 || y > H) continue;

      if (row.type === 'group') {
        ctx.fillStyle = row.color + '12';
        ctx.fillRect(sl, y, canvasW + sl, GROUP_H_C);  // full viewport after translate
        continue;
      }

      const si = sampleIdxMap?.[row.sid] ?? sampleList.indexOf(row.sid);

      for (let ci = startCI; ci <= endCI; ci++) {
        const col = msaColumns[ci];
        if (!col) continue;
        const cx = ci * COL_W_C;  // absolute coords (translate handles scroll)

        if (col.type === 'ins') {
          const b = (sampleInsMap?.[row.sid]?.[col.afterPos] || '')[col.insIdx] || '';
          if (b) {
            ctx.fillStyle = '#ede9fe';
            ctx.fillRect(cx, y, COL_W_C-1, ROW_H_C-1);
            ctx.fillStyle = BASE_C[b] || '#7c3aed';
            ctx.fillText(b, cx + COL_W_C/2, y + ROW_H_C/2);
          }
          continue;
        }

        const refBase = gene.seq[col.pos - 1] || 'N';
        const pd = pdMapRef.current.get(col.pos);
        const allele = getAllele(pd, si, refBase);

        if (allele === '-') {
          ctx.fillStyle = '#e2e0db';
          ctx.fillRect(cx, y, COL_W_C-1, ROW_H_C-1);
        } else if (allele === 'D') {
          ctx.fillStyle = '#c8c5be';
          ctx.fillRect(cx, y, COL_W_C-1, ROW_H_C-1);
          ctx.strokeStyle = '#9a9690'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx+4, y+ROW_H_C/2); ctx.lineTo(cx+COL_W_C-5, y+ROW_H_C/2);
          ctx.stroke();
        } else if (allele === refBase) {
          ctx.fillStyle = '#bbb';
          ctx.fillText('·', cx + COL_W_C/2, y + ROW_H_C/2);
        } else {
          const base = allele.includes('+') ? allele[0] : allele;
          ctx.fillStyle = BASE_C[base] || '#666';
          ctx.fillRect(cx, y, COL_W_C-1, ROW_H_C-1);
          ctx.fillStyle = '#fff';
          ctx.fillText(base, cx + COL_W_C/2, y + ROW_H_C/2);
          if (allele.includes('+')) {
            ctx.fillStyle = '#c4b5fd';
            ctx.font = '9px monospace';
            ctx.fillText('+', cx+COL_W_C-5, y+7);
            ctx.font = '11px "JetBrains Mono",monospace';
          }
        }
      }
    }

    // drag highlight
    if (dragSelection) {
      const s = Math.min(dragSelection.startPos, dragSelection.endPos);
      const e = Math.max(dragSelection.startPos, dragSelection.endPos);
      let x1=-1, x2=-1;
      for (let ci=0; ci<msaColumns.length; ci++) {
        const col = msaColumns[ci];
        if (col.type !== 'ref') continue;
        if (col.pos >= s && x1 < 0) x1 = ci*COL_W_C;
        if (col.pos >= e) { x2 = (ci+1)*COL_W_C; break; }
      }
      if (x1 >= 0) {
        if (x2 < 0) x2 = msaColumns.length*COL_W_C;
        ctx.fillStyle = 'rgba(37,99,235,0.10)';
        ctx.fillRect(x1, 0, x2-x1, H);
        ctx.strokeStyle = 'rgba(37,99,235,0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x1, 0, x2-x1, H);
      }
    }

    ctx.restore();
  }

  // scroll → update visible range (translateX handles position; redraw just updates the range)
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const onScroll = () => {
      const sl = el.scrollLeft;
      if (scrollLeftRef) scrollLeftRef.current = sl;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        drawFrame(sl);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]); // eslint-disable-line

  useEffect(() => {
    drawFrame(scrollRef?.current?.scrollLeft || 0);
  });

  // mouse hover
  const handleMouseMove = useCallback((e) => {
    if (!gene || !msaColumns?.length) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sl = scrollRef?.current?.scrollLeft || 0;
    const x = e.clientX - rect.left + sl;
    const y = e.clientY - rect.top;
    const row = layoutRef.current.find(r =>
      y >= r.y && y < r.y + (r.type === 'group' ? GROUP_H_C : ROW_H_C)
    );
    if (!row || row.type !== 'sample') { onLeave(); return; }
    const ci = Math.floor(x / COL_W_C);
    const col = msaColumns[ci];
    if (col) onHover(e, row.sid, col);
  }, [msaColumns, gene, scrollRef, onHover, onLeave]); // eslint-disable-line

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        // sticky: fixed on screen inside the scroll container
        position: 'sticky',
        left: 0,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={onLeave}
    />
  );
}

// ─── SampleRow (kept for reference) ──────────────────────────────────────────
const SampleRow = React.memo(function SampleRow({ sid, gene, pileup, cols, groupColor, sampleInsSeqs, padLeft, padRight, hasPad, onHover, onLeave }) {
  return (
    <tr className="vo-sample-row">
      <td className="vo-label vo-sample-label" style={{ borderLeftColor: groupColor }}><span className="vo-sample-id">{sid}</span></td>
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
const AltSampleRatioRow = React.memo(function AltSampleRatioRow({ cols, gene, samples, getPileup, sampleInsMap, padLeft, padRight, hasPad }) {
  if (!gene || !samples?.length) return null;
  return (
    <tr className="vo-ratio-row">
      <td className="vo-label vo-ratio-label">Alt sample</td>
      {hasPad && padLeft > 0 && <td style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft, padding: 0, border: 'none', background: '#f5f4f1' }} />}
      {cols.map((col, i) => {
        if (col.type === 'ins') {
          // Count how many samples have an inserted base at this ins column
          let hasIns = 0;
          for (const sid of samples) {
            const insSeq = sampleInsMap[sid]?.[col.afterPos] || '';
            if (insSeq.length > col.insIdx) hasIns++;
          }
          const pct = Math.round((hasIns / samples.length) * 100);
          const bg = pct > 50 ? '#f5f3ff' : pct > 5 ? '#faf5ff' : '#fafafa';
          const color = pct > 50 ? '#7c3aed' : pct > 5 ? '#a855f7' : '#d4d4d4';
          return <td key={`ins-${col.afterPos}-${col.insIdx}`} className="vo-cell vo-ratio-cell vo-ins-col" style={{ background: bg, color }}>{hasIns > 0 ? hasIns : '·'}</td>;
        }
        return <AltSampleCell key={col.pos} pos={col.pos} gene={gene} samples={samples} getPileup={getPileup} />;
      })}
      {hasPad && padRight > 0 && <td style={{ width: padRight, minWidth: padRight, maxWidth: padRight, padding: 0, border: 'none', background: '#f5f4f1' }} />}
    </tr>
  );
});

function AltSampleCell({ pos, gene, samples, getPileup }) {
  const [popup, setPopup] = useState(null);
  const ref = gene.seq[pos - 1] || 'N';
  let mapped = 0, noCov = 0, altDom = 0, refDom = 0;

  for (const sid of samples) {
    const pileup = getPileup(gene.id, sid);
    if (!pileup) { noCov++; continue; }
    const p = pileup[String(pos)];
    if (!p) { noCov++; continue; }
    const tot = p.A + p.T + p.G + p.C + (p.del || 0);
    if (tot < 5) { noCov++; continue; }
    mapped++;
    const bases = { A: p.A || 0, T: p.T || 0, G: p.G || 0, C: p.C || 0 };
    const dom = Object.entries(bases).sort((a, b) => b[1] - a[1])[0][0];
    if (dom !== ref || (p.del || 0) > tot * 0.3) altDom++;
    else refDom++;
  }

  if (mapped === 0) return <td className="vo-cell vo-ratio-cell">—</td>;
  const pct = Math.round((altDom / mapped) * 100);
  const bg = pct > 50 ? '#fef2f2' : pct > 5 ? '#fffbeb' : '#f0fdf4';
  const color = pct > 50 ? '#dc2626' : pct > 5 ? '#d97706' : '#16a34a';

  const handleClick = (e) => {
    if (popup) { setPopup(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setPopup({ x: rect.left + rect.width / 2, y: rect.top - 4 });
  };

  return (
    <td className="vo-cell vo-ratio-cell" style={{ background: bg, color, cursor: 'pointer' }}
      onClick={handleClick} onMouseLeave={() => setPopup(null)}>
      {altDom > 0 ? `${altDom}` : '0'}
      {popup && ReactDOM.createPortal(
        <div className="ratio-popup" style={{
          left: Math.max(10, Math.min(popup.x - 90, window.innerWidth - 200)),
          top: popup.y - 130,
        }}>
          <div className="ratio-popup-hd">{gene.chr}:{(pos + gene.offset).toLocaleString()} <span style={{ color: '#999' }}>local:{pos}</span></div>
          <div className="ratio-popup-ref">ref: <b style={{ color: BASE_COL[ref] }}>{ref}</b></div>
          <div className="ratio-popup-sep" />
          <div className="ratio-popup-row"><span>Mapped samples:</span><b>{mapped}</b> / {samples.length}</div>
          <div className="ratio-popup-row"><span>No coverage:</span><b>{noCov}</b></div>
          <div className="ratio-popup-sep" />
          <div className="ratio-popup-row"><span>Ref-dominant:</span><b style={{ color: '#16a34a' }}>{refDom}</b></div>
          <div className="ratio-popup-row"><span>Alt-dominant:</span><b style={{ color: '#dc2626' }}>{altDom}</b></div>
          <div className="ratio-popup-pct" style={{ color }}>{altDom}/{mapped} ({pct}%)</div>
        </div>,
        document.body
      )}
    </td>
  );
}

// ─── Alt Read Ratio: total alt reads / total reads across all samples ───
const AltReadRatioRow = React.memo(function AltReadRatioRow({ cols, gene, samples, getPileup, padLeft, padRight, hasPad }) {
  if (!gene || !samples?.length) return null;
  return (
    <tr className="vo-ratio-row">
      <td className="vo-label vo-ratio-label">Alt read</td>
      {hasPad && padLeft > 0 && <td style={{ width: padLeft, minWidth: padLeft, maxWidth: padLeft, padding: 0, border: 'none', background: '#f5f4f1' }} />}
      {cols.map((col, i) => {
        if (col.type === 'ins') {
          return <td key={`ins-${col.afterPos}-${col.insIdx}`} className="vo-cell vo-ratio-cell vo-ins-col" style={{ color: '#d4d4d4' }}>·</td>;
        }
        return <AltReadCell key={col.pos} pos={col.pos} gene={gene} samples={samples} getPileup={getPileup} />;
      })}
      {hasPad && padRight > 0 && <td style={{ width: padRight, minWidth: padRight, maxWidth: padRight, padding: 0, border: 'none', background: '#f5f4f1' }} />}
    </tr>
  );
});

function AltReadCell({ pos, gene, samples, getPileup }) {
  const [popup, setPopup] = useState(null);
  const ref = gene.seq[pos - 1] || 'N';
  let refCount = 0, altCount = 0, totalSamples = 0, noCovCount = 0;
  const baseTotals = { A: 0, T: 0, G: 0, C: 0, del: 0 };

  for (const sid of samples) {
    const pileup = getPileup(gene.id, sid);
    if (!pileup) { noCovCount++; continue; }
    const p = pileup[String(pos)];
    if (!p) { noCovCount++; continue; }
    const tot = p.A + p.T + p.G + p.C + (p.del || 0);
    if (tot < 5) { noCovCount++; continue; }
    totalSamples++;
    for (const b of ['A', 'T', 'G', 'C', 'del']) baseTotals[b] += (p[b] || 0);
    const refReads = p[ref] || 0;
    refCount += refReads;
    altCount += (tot - refReads);
  }

  const total = refCount + altCount;
  if (total === 0 || totalSamples === 0) return <td className="vo-cell vo-ratio-cell">—</td>;
  const altPct = Math.round((altCount / total) * 100);
  const bg = altPct > 50 ? '#fef2f2' : altPct > 10 ? '#fffbeb' : '#f0fdf4';
  const color = altPct > 50 ? '#dc2626' : altPct > 10 ? '#d97706' : '#16a34a';

  const handleClick = (e) => {
    if (popup) { setPopup(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setPopup({ x: rect.left + rect.width / 2, y: rect.top - 4 });
  };

  return (
    <td className="vo-cell vo-ratio-cell" style={{ background: bg, color, cursor: 'pointer' }}
      onClick={handleClick} onMouseLeave={() => setPopup(null)}>
      {altPct}%
      {popup && ReactDOM.createPortal(
        <div className="ratio-popup" style={{
          left: Math.max(10, Math.min(popup.x - 90, window.innerWidth - 200)),
          top: popup.y - 180,
        }}>
          <div className="ratio-popup-hd">{gene.chr}:{(pos + gene.offset).toLocaleString()} <span style={{ color: '#999' }}>local:{pos}</span></div>
          <div className="ratio-popup-ref">ref: <b style={{ color: BASE_COL[ref] }}>{ref}</b></div>
          <div className="ratio-popup-sep" />
          <div className="ratio-popup-row"><span>Mapped samples:</span><b>{totalSamples}</b> / {samples.length}</div>
          <div className="ratio-popup-row"><span>No coverage:</span><b>{noCovCount}</b></div>
          <div className="ratio-popup-sep" />
          <div className="ratio-popup-row">
            <span style={{ color: BASE_COL.A }}>A:</span><b>{baseTotals.A.toLocaleString()}</b>
            <span style={{ color: BASE_COL.T, marginLeft: 6 }}>T:</span><b>{baseTotals.T.toLocaleString()}</b>
          </div>
          <div className="ratio-popup-row">
            <span style={{ color: BASE_COL.G }}>G:</span><b>{baseTotals.G.toLocaleString()}</b>
            <span style={{ color: BASE_COL.C, marginLeft: 6 }}>C:</span><b>{baseTotals.C.toLocaleString()}</b>
          </div>
          <div className="ratio-popup-row"><span style={{ color: '#94a3b8' }}>Del:</span><b>{baseTotals.del.toLocaleString()}</b></div>
          <div className="ratio-popup-sep" />
          <div className="ratio-popup-row">
            <span>Ref reads:</span><b>{refCount.toLocaleString()}</b>
            <span style={{ marginLeft: 6 }}>Alt reads:</span><b style={{ color: '#dc2626' }}>{altCount.toLocaleString()}</b>
          </div>
          <div className="ratio-popup-pct" style={{ color }}>{altPct}% alt reads</div>
        </div>,
        document.body
      )}
    </td>
  );
}
