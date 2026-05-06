import React, { useMemo, useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { getAlleleForSample } from '../utils/haplotype.js';

const COL_W = 24;
const LABEL_W = 150;
const ROW_H = 22;
const GROUP_H = 24;
const OVERSCAN = 40;

const GENETIC_CODE = {
  'ATA':'I','ATC':'I','ATT':'I','ATG':'M','ACA':'T','ACC':'T','ACG':'T','ACT':'T',
  'AAC':'N','AAT':'N','AAA':'K','AAG':'K','AGC':'S','AGT':'S','AGA':'R','AGG':'R',
  'CTA':'L','CTC':'L','CTG':'L','CTT':'L','CCA':'P','CCC':'P','CCG':'P','CCT':'P',
  'CAC':'H','CAT':'H','CAA':'Q','CAG':'Q','CGA':'R','CGC':'R','CGG':'R','CGT':'R',
  'GTA':'V','GTC':'V','GTG':'V','GTT':'V','GCA':'A','GCC':'A','GCG':'A','GCT':'A',
  'GAC':'D','GAT':'D','GAA':'E','GAG':'E','GGA':'G','GGC':'G','GGG':'G','GGT':'G',
  'TCA':'S','TCC':'S','TCG':'S','TCT':'S','TTC':'F','TTT':'F','TTA':'L','TTG':'L',
  'TAC':'Y','TAT':'Y','TAA':'*','TAG':'*','TGC':'C','TGT':'C','TGA':'*','TGG':'W',
};

const BASE_BG = { A:'#1d6fba',T:'#15803d',G:'#b35a00',C:'#c41c1c',D:'#94a3b8' };
const AA_COL  = { nonsynonymous:'#ef4444', stop:'#7c3aed', synonymous:'#16a34a' };
const HAP_COLORS = [
  '#2563eb','#16a34a','#d97706','#dc2626','#7c3aed',
  '#0891b2','#be185d','#059669','#ea580c','#4f46e5',
  '#0d9488','#b45309','#9333ea','#0284c7','#15803d','#c2410c',
];

const CDSViewCanvas = forwardRef(function CDSViewCanvas({
  gene, hapData, positionData, shownSamples, sampleList, sampleIdxMap
}, ref) {
  const scrollRef     = useRef(null);
  const canvasRef     = useRef(null);
  const isDraggingRef = useRef(false);
  const lastXRef      = useRef(0);
  const layoutRef     = useRef([]);
  const [renderRange, setRenderRange] = useState({ startIdx:0, endIdx:OVERSCAN*2 });
  const [copiedCi,    setCopiedCi]    = useState(null);

  // ── 1. cdsCols ──────────────────────────────────────────────────────────────
  const cdsCols = useMemo(() => {
    if (!gene?.cdsMap || !gene?.cdsSeq) return [];
    const pdMap = new Map();
    (positionData || []).forEach(pd => pdMap.set(pd.pos, pd));

    return Object.entries(gene.cdsMap)
      .map(([lpos, info]) => ({
        pos: parseInt(lpos),
        ci: info.ci, cn: info.cn, cp: info.cp,
        refBase: gene.cdsSeq[info.ci] || 'N',
        pd: pdMap.get(parseInt(lpos)) || null,
      }))
      .sort((a, b) => a.ci - b.ci);
  }, [gene, positionData]);

  const hasFrameshift = useMemo(() =>
    cdsCols.some(c => c.pd?.aaChange?.frameshift), [cdsCols]);

  // ── 2. virtual scroll ───────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const sl = scrollRef.current.scrollLeft;
    const vw = scrollRef.current.clientWidth - LABEL_W;
    const si = Math.max(0, Math.floor(sl / COL_W) - OVERSCAN);
    const ei = Math.min(cdsCols.length, Math.ceil((sl + vw) / COL_W) + OVERSCAN);
    setRenderRange({ startIdx:si, endIdx:ei });
  }, [cdsCols.length]);

  useEffect(() => { handleScroll(); }, [handleScroll]);

  const visibleCols = useMemo(() =>
    cdsCols.slice(renderRange.startIdx, renderRange.endIdx),
    [cdsCols, renderRange]);
  const padLeft = renderRange.startIdx * COL_W;

  // ── 3. layout ───────────────────────────────────────────────────────────────
  const shownSet = useMemo(() => new Set(shownSamples || []), [shownSamples]);

  const layout = useMemo(() => {
    if (!hapData) return [];
    let y = 0;
    const rows = [];
    hapData.haplotypes.forEach((hap, hi) => {
      const color = HAP_COLORS[hi % HAP_COLORS.length];
      const vis   = hap.samples.filter(s => shownSet.has(s));
      if (!vis.length) return;
      rows.push({ type:'group', id:hap.id, color, y, h:GROUP_H });
      y += GROUP_H;
      vis.forEach(sid => {
        rows.push({ type:'sample', sid, color, y, h:ROW_H });
        y += ROW_H;
      });
    });
    layoutRef.current = rows;
    return rows;
  }, [hapData, shownSet]);

  const totalH = layout.length ? layout[layout.length-1].y + layout[layout.length-1].h : 0;

  // ── 4. panning ──────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(e => {
    isDraggingRef.current = true;
    lastXRef.current = e.clientX;
    e.preventDefault();
  }, []);
  useEffect(() => {
    const onMove = e => {
      if (!isDraggingRef.current || !scrollRef.current) return;
      scrollRef.current.scrollLeft -= e.clientX - lastXRef.current;
      lastXRef.current = e.clientX;
    };
    const onUp = () => { isDraggingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',  onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── 5. canvas drawFrame ─────────────────────────────────────────────────────
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visibleCols.length || !totalH) return;
    const dpr = window.devicePixelRatio || 1;
    const W = visibleCols.length * COL_W;
    const H = totalH;

    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.style.left   = `${padLeft}px`;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Background (prevent see-through)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.font = `11px "JetBrains Mono",monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const sampleRows = layoutRef.current.filter(r => r.type === 'sample');
    const bk = {}, tx = [];

    for (let j = 0; j < visibleCols.length; j++) {
      const col = visibleCols[j];
      const x   = j * COL_W;

      // Codon-boundary vertical lines
      if (col.cp === 0) {
        ctx.strokeStyle = '#d0cdc6';
        ctx.lineWidth   = 0.5;
        ctx.beginPath(); ctx.moveTo(x+0.5, 0); ctx.lineTo(x+0.5, H); ctx.stroke();
      }

      for (const row of sampleRows) {
        const { y, h, sid } = row;
        // allele lookup
        const si  = sampleIdxMap?.[sid] ?? (sampleList||[]).indexOf(sid);
        let a = col.refBase;
        const pd = col.pd;
        if (pd) {
          if (pd.enc !== undefined) {
            const ch = si >= 0 && si < pd.enc.length ? pd.enc[si] : '0';
            if (ch === '-') a = '-';
            else if (ch !== '0') {
              const ai = parseInt(ch) - 1;
              a = ai < (pd.alt||[]).length ? pd.alt[ai] : col.refBase;
            }
          } else if (pd.alleles) {
            a = pd.alleles[sid] ?? col.refBase;
          }
        }
        const base = a.includes('+') ? a[0] : a;
        const isAlt = base !== col.refBase;

        if (!isAlt) {
          tx.push({ t:'·', x:x+COL_W/2, y:y+h/2, c:'#bbb' });
        } else if (base === 'D' || base === '-') {
          if (!bk.D) bk.D = [];
          bk.D.push([x, y, COL_W-1, h-1]);
        } else {
          if (!bk[base]) bk[base] = [];
          bk[base].push([x, y, COL_W-1, h-1]);
          tx.push({ t:base, x:x+COL_W/2, y:y+h/2, c:'#fff' });
        }
      }

      // Group background
      for (const row of layoutRef.current) {
        if (row.type === 'group') {
          if (!bk._grp) bk._grp = [];
          bk._grp.push([0, row.y, W, row.h, row.color]);
        }
      }
    }

    // Group background first
    if (bk._grp) {
      for (const [rx,ry,rw,rh,col] of bk._grp) {
        ctx.fillStyle = col + '18';
        ctx.fillRect(rx, ry, rw, rh);
      }
    }
    // base background
    for (const [base, rects] of Object.entries(bk)) {
      if (base === '_grp') continue;
      ctx.fillStyle = BASE_BG[base] || '#888';
      for (const [rx,ry,rw,rh] of rects) ctx.fillRect(rx, ry, rw, rh);
    }
    // Text
    tx.sort((a,b) => a.c < b.c ? -1 : 1);
    let lc = '';
    for (const t of tx) {
      if (t.c !== lc) { ctx.fillStyle = t.c; lc = t.c; }
      ctx.fillText(t.t, t.x, t.y);
    }
    ctx.restore();
  }, [visibleCols, totalH, padLeft, sampleIdxMap, sampleList]);

  useEffect(() => { drawFrame(); }, [drawFrame]);

  // ── 6. Click-to-copy position ──────────────────────────────────────────────
  const handlePosClick = useCallback((ci) => {
    navigator.clipboard?.writeText(String(ci + 1)).catch(() => {});
    setCopiedCi(ci);
    setTimeout(() => setCopiedCi(null), 1200);
  }, []);

  // ── helpers ─────────────────────────────────────────────────────────────────
  const getRefAA = ci => {
    const codon = gene?.cdsSeq?.slice(ci, ci+3) || '';
    return GENETIC_CODE[codon.toUpperCase()] || '?';
  };
  const getAltAAInfo = col => {
    if (!col.pd?.aaChange?.alts) return null;
    const fst = Object.values(col.pd.aaChange.alts)[0];
    return fst || null;
  };

  // ── early return (after all hooks) ─────────────────────────────────────────
  if (!gene?.cdsSeq || !cdsCols.length) {
    return (
      <div style={{ padding:20, color:'#888', fontSize:12 }}>
        {gene && !gene.cdsSeq
          ? '⟳ Loading CDS data...'
          : 'CDS data not available. Run: python scripts/precompute.py --force'}
      </div>
    );
  }

  const thL = (extra={}) => ({
    position:'sticky', left:0, zIndex:6, background:'var(--bg1)',
    width:LABEL_W, minWidth:LABEL_W, padding:'0 8px', textAlign:'left',
    fontSize:10, fontFamily:'var(--mono)', fontWeight:600,
    borderRight:'1px solid var(--border)', borderBottom:'1px solid var(--bg3)',
    whiteSpace:'nowrap', overflow:'hidden', ...extra,
  });
  const thC = (extra={}) => ({
    width:COL_W, minWidth:COL_W, maxWidth:COL_W, padding:0,
    textAlign:'center', fontSize:9, fontFamily:'var(--mono)',
    borderBottom:'1px solid var(--bg3)', boxSizing:'border-box', ...extra,
  });
  const padTh = padLeft > 0
    ? <th style={{ width:padLeft, minWidth:padLeft, padding:0, border:'none', background:'inherit' }} />
    : null;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div ref={scrollRef} onScroll={handleScroll} onMouseDown={handleMouseDown}
        style={{ flex:1, overflow:'auto', cursor:'grab', userSelect:'none' }}>
        <div style={{ width: LABEL_W + cdsCols.length * COL_W }}>
          <table style={{ tableLayout:'fixed', borderCollapse:'collapse', fontSize:10,
            width: LABEL_W + cdsCols.length * COL_W }}>
            <thead style={{ position:'sticky', top:0, zIndex:10 }}>

              {/* Row 1: CDS position */}
              <tr style={{ background:'var(--bg2)' }}>
                <th style={thL({ fontWeight:700, color:'var(--t2)' })}>CDS position</th>
                {padTh}
                {visibleCols.map(col => (
                  <th key={col.ci} onClick={() => handlePosClick(col.ci)}
                    style={thC({
                      height:40, writingMode:'vertical-rl',
                      textAlign:'left', verticalAlign:'bottom', paddingBottom:2, paddingLeft:4,
                      borderLeft: col.cp===0 ? '1px solid var(--border)' : 'none',
                      color: copiedCi===col.ci ? '#fff' : 'var(--t2)',
                      background: copiedCi===col.ci ? 'var(--accent)' : 'var(--bg2)',
                      cursor:'pointer', fontSize:8,
                    })}>
                    {col.ci + 1}
                  </th>
                ))}
              </tr>

              {/* Row 2: Codon */}
              <tr style={{ background:'var(--bg3)' }}>
                <th style={thL({ color:'var(--t2)', fontWeight:400 })}>Codon</th>
                {padTh}
                {visibleCols.filter(c => c.cp===0).map(col => (
                  <th key={col.ci} colSpan={3}
                    style={thC({ width:COL_W*3, minWidth:COL_W*3, maxWidth:COL_W*3,
                      borderLeft:'1px solid var(--border)', color:'var(--t1)', fontWeight:600 })}>
                    {col.cn}
                  </th>
                ))}
              </tr>

              {/* Row 3: Ref AA */}
              <tr style={{ background:'#f0fdf4' }}>
                <th style={thL({ color:'#16a34a' })}>Ref amino acid</th>
                {padTh}
                {visibleCols.filter(c => c.cp===0).map(col => (
                  <th key={col.ci} colSpan={3}
                    title={`Codon ${col.cn}: ${gene.cdsSeq.slice(col.ci, col.ci+3)}`}
                    style={thC({ width:COL_W*3, minWidth:COL_W*3, maxWidth:COL_W*3,
                      borderLeft:'1px solid var(--border)', fontSize:13, fontWeight:700,
                      color:'#16a34a', background:'#f0fdf4' })}>
                    {getRefAA(col.ci)}
                  </th>
                ))}
              </tr>

              {/* Row 4: Ref NT */}
              <tr style={{ background:'#f0fdf4' }}>
                <th style={thL({ color:'#16a34a', fontWeight:400 })}>Ref nucleotide</th>
                {padTh}
                {visibleCols.map(col => (
                  <th key={col.ci}
                    style={thC({ fontWeight:700, color:'var(--t0)', background:'#f0fdf4',
                      borderLeft: col.cp===0 ? '1px solid var(--border)' : 'none' })}>
                    {col.refBase}
                  </th>
                ))}
              </tr>

              {/* Row 5: Alt AA */}
              <tr style={{ background:'#fff7ed' }}>
                <th style={thL({ color:'#ea580c' })}>Alt amino acid</th>
                {padTh}
                {visibleCols.filter(c => c.cp===0).map(col => {
                  // Find alt AA at this codon (cn)
                  const fc = cdsCols.slice(col.ci, col.ci+3).find(c => c.pd?.aaChange?.alts);
                  const info = fc ? getAltAAInfo(fc) : null;
                  const isFS = cdsCols.slice(col.ci, col.ci+3).some(c => c.pd?.aaChange?.frameshift);
                  return (
                    <th key={col.ci} colSpan={3}
                      style={thC({ width:COL_W*3, minWidth:COL_W*3, maxWidth:COL_W*3,
                        borderLeft:'1px solid var(--border)', fontSize:13, fontWeight:700,
                        color: info ? (AA_COL[info.type] || '#ea580c') : 'var(--t3)',
                        background: isFS ? '#fef3c7' : '#fff7ed' })}>
                      {info ? (isFS ? `⚡${info.aa||''}` : info.aa) : '·'}
                    </th>
                  );
                })}
              </tr>

              {/* Row 6: Alt NT */}
              <tr style={{ background:'#fff7ed' }}>
                <th style={thL({ color:'#ea580c', fontWeight:400 })}>Alt nucleotide</th>
                {padTh}
                {visibleCols.map(col => {
                  const a = col.pd?.alt?.[0] || null;
                  const isDel = a === 'D';
                  const isIns = a?.includes('+');
                  const disp  = isDel ? 'Δ' : isIns ? a.split('+')[0]+'+' : a;
                  return (
                    <th key={col.ci}
                      style={thC({
                        fontWeight: a ? 700 : 400,
                        background: isDel ? '#fee2e2' : isIns ? '#ede9fe'
                          : a ? (BASE_BG[a]||'#888')+'33' : '#fff7ed',
                        color: isDel ? '#dc2626' : isIns ? '#7c3aed'
                          : a ? (BASE_BG[a]||'#ea580c') : 'var(--t3)',
                        borderLeft: col.cp===0 ? '1px solid var(--border)' : 'none',
                        fontSize: isIns ? 7 : 10,
                      })}>
                      {a ? disp : '·'}
                    </th>
                  );
                })}
              </tr>

              {/* Row 7: Frameshift (conditional) */}
              {hasFrameshift && (
                <tr style={{ background:'#fffbeb' }}>
                  <th style={thL({ color:'#d97706', fontWeight:400, fontSize:9 })}>Frameshift</th>
                  {padTh}
                  {visibleCols.map(col => (
                    <th key={col.ci}
                      style={thC({
                        background: col.pd?.aaChange?.frameshift ? '#fde68a' : '#fffbeb',
                        color:'#d97706', fontSize:9,
                        borderLeft: col.cp===0 ? '1px solid var(--border)' : 'none',
                      })}>
                      {col.pd?.aaChange?.frameshift ? '⚡' : ''}
                    </th>
                  ))}
                </tr>
              )}
            </thead>

            <tbody>
              <tr>
                {/* Fixed label */}
                <td style={{
                  position:'sticky', left:0, zIndex:4, background:'var(--bg1)',
                  width:LABEL_W, minWidth:LABEL_W, verticalAlign:'top', padding:0,
                  borderRight:'1px solid var(--border)',
                }}>
                  {layout.map((row, i) => (
                    <div key={i} style={{
                      height: row.type==='group' ? GROUP_H : ROW_H,
                      display:'flex', alignItems:'center',
                      padding:'0 6px 0 8px', fontSize:10, fontFamily:'var(--mono)',
                      fontWeight: row.type==='group' ? 700 : 400,
                      color: row.color,
                      background: row.type==='group' ? row.color+'15' : 'var(--bg1)',
                      borderBottom:'1px solid var(--bg3)',
                      borderLeft: row.type==='sample' ? `3px solid ${row.color}` : 'none',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                    }}>
                      {row.type==='group' ? row.id : row.sid}
                    </div>
                  ))}
                </td>
                {/* Canvas */}
                <td style={{ verticalAlign:'top', padding:0 }} colSpan={2}>
                  <div style={{
                    position:'relative',
                    width: cdsCols.length * COL_W,
                    height: totalH,
                  }}>
                    <canvas ref={canvasRef}
                      style={{ position:'absolute', left:padLeft, top:0, display:'block' }} />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});

export default CDSViewCanvas;
