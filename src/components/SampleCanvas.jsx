/**
 * SampleCanvas.jsx - Canvas-based sample renderer (v2)
 *
 * Structure:
 *   [label div 130px] [Canvas: visibleCols × ROW_H × nRows]
 *
 * Scrolling:
 *   The parent GenomeView's scrollRef scrolls the whole layout.
 *   Canvas only draws visibleCols (virtual scroll).
 *   padLeft/padRight spacers are handled the same as the parent table.
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { HAP_COLORS } from '../utils/constants.js';
import { getAlleleForSample } from '../utils/haplotype.js';

const ROW_H = 20;
const GROUP_H = 22;
const LABEL_W = 130;
const COL_W = 24;
const FONT = '11px "JetBrains Mono", monospace';
const FONT_SM = '9px "JetBrains Mono", monospace';

const C = {
  nocov: '#e2e0db', del: '#c8c5be', ins: '#ede9fe',
  A: '#1d6fba', T: '#15803d', G: '#b35a00', C: '#c41c1c',
  ref_dot: '#bbb', row_bg: '#faf9f7',
};

export default function SampleCanvas({
  groups, gene,
  msaColumns,         // full msa columns (Canvas computes visibleCols internally)
  visibleCols,        // fallback
  padLeft, padRight, totalW,
  positionData, sampleIdxMap, sampleList,
  sampleInsMap,
  onHover, onLeave,
  onColumnDragEnd, dragSelection,
  scrollLeft,
  scrollRef,          // ref for direct access
  viewW,
}) {
  const BUFFER = 30;
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const colDragRef = useRef({ active: false, startPos: null, endPos: null });

  // Compute visibleCols directly from scrollRef.current (no React state needed)
  const computeVisibleCols = useCallback(() => {
    if (!msaColumns || !msaColumns.length) return { cols: visibleCols || [], pL: padLeft, pR: padRight };
    const sl = scrollRef?.current?.scrollLeft ?? scrollLeft ?? 0;
    const vw = viewW ?? 800;
    const total = msaColumns.length;
    if (total * COL_W <= vw + LABEL_W) return { cols: msaColumns, pL: 0, pR: 0 };
    const si = Math.max(0, Math.floor(sl / COL_W) - BUFFER);
    const ei = Math.min(total - 1, Math.ceil((sl + vw + LABEL_W) / COL_W) + BUFFER);
    const cols = msaColumns.slice(si, ei + 1);
    const pL = si * COL_W;
    const pR = Math.max(0, total * COL_W - pL - cols.length * COL_W);
    return { cols, pL, pR };
  }, [msaColumns, visibleCols, padLeft, padRight, scrollLeft, scrollRef, viewW]);

  // pdMap
  const pdMap = useMemo(() => {
    const m = new Map();
    (positionData || []).forEach(pd => m.set(pd.pos, pd));
    return m;
  }, [positionData]);

  // Build sampleIdxMap from sampleList internally (in case props arrive late)
  const resolvedIdxMap = useMemo(() => {
    if (sampleIdxMap && Object.keys(sampleIdxMap).length > 0) return sampleIdxMap;
    const m = {};
    (sampleList || []).forEach((sid, i) => { m[sid] = i; });
    return m;
  }, [sampleIdxMap, sampleList]);

  // Compute layout
  const { rows, totalH } = useMemo(() => {
    const rows = [];
    let y = 0;
    (groups || []).forEach((group, gi) => {
      rows.push({ type: 'group', y, group });
      y += GROUP_H;
      (group.vis || []).forEach(sid => {
        rows.push({ type: 'sample', y, sid, color: group.color });
        y += ROW_H;
      });
    });
    return { rows, totalH: y };
  }, [groups]);

  // draw function
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gene || !rows.length) return;

    const dpr = window.devicePixelRatio || 1;
    const canvasW = canvas.width / dpr;
    const canvasH = canvas.height / dpr;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasW, canvasH);

    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    rows.forEach(row => {
      const { y } = row;

      if (row.type === 'group') {
        const g = row.group;
        // Group-header background
        ctx.fillStyle = g.color + '15';
        ctx.fillRect(0, y, canvasW, GROUP_H);
        // Labels are rendered by the label div; canvas only draws the background
        return;
      }

      // sample row
      const { sid, color } = row;
      const si = resolvedIdxMap[sid] ?? -1;

      // padLeft spacer
      if (padLeft > 0) {
        ctx.fillStyle = '#f5f4f1';
        ctx.fillRect(0, y, padLeft, ROW_H);
      }

      visibleCols.forEach((col, vi) => {
        const cx = padLeft + vi * COL_W;

        if (col.type === 'ins') {
          const insSeq = sampleInsMap?.[sid]?.[col.afterPos] || '';
          const b = insSeq[col.insIdx] || '';
          if (b) {
            ctx.fillStyle = C.ins;
            ctx.fillRect(cx, y, COL_W - 1, ROW_H - 1);
            ctx.fillStyle = C[b] || '#7c3aed';
            ctx.fillText(b, cx + COL_W / 2, y + ROW_H / 2);
          }
          return;
        }

        const pos = col.pos;
        const ref = gene.seq[pos - 1] || 'N';
        const pd = pdMap.get(pos);

        // Determine allele
        let allele = ref;
        if (pd && si >= 0) {
          allele = getAlleleForSample(pd, si, sampleList, ref);
        }

        // no coverage
        if (allele === '-') {
          ctx.fillStyle = C.nocov;
          ctx.fillRect(cx, y, COL_W - 1, ROW_H - 1);
          return;
        }
        // deletion
        if (allele === 'D') {
          ctx.fillStyle = C.del;
          ctx.fillRect(cx, y, COL_W - 1, ROW_H - 1);
          ctx.strokeStyle = '#9a9690';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx + 4, y + ROW_H / 2);
          ctx.lineTo(cx + COL_W - 5, y + ROW_H / 2);
          ctx.stroke();
          return;
        }

        const baseChar = allele.includes('+') ? allele[0] : allele;
        const isRef = baseChar === ref && !allele.includes('+');

        if (isRef) {
          // Match: just a dot
          ctx.fillStyle = C.ref_dot;
          ctx.fillText('·', cx + COL_W / 2, y + ROW_H / 2);
          return;
        }

        // Variant: background + glyph
        ctx.fillStyle = C[baseChar] || '#666';
        ctx.fillRect(cx, y, COL_W - 1, ROW_H - 1);
        ctx.fillStyle = '#fff';
        ctx.fillText(baseChar, cx + COL_W / 2, y + ROW_H / 2);

        // Show insertion
        if (allele.includes('+')) {
          ctx.fillStyle = '#c4b5fd';
          ctx.font = FONT_SM;
          ctx.fillText('+', cx + COL_W - 5, y + 7);
          ctx.font = FONT;
        }
      });

      // padRight spacer
      if (padRight > 0) {
        ctx.fillStyle = '#f5f4f1';
        ctx.fillRect(padLeft + visibleCols.length * COL_W, y, padRight, ROW_H);
      }
    });

    // Drag-selection highlight
    if (dragSelection && gene) {
      const s = Math.min(dragSelection.startPos, dragSelection.endPos);
      const e = Math.max(dragSelection.startPos, dragSelection.endPos);
      const si = activeCols.findIndex(c => c.type === 'ref' && c.pos >= s);
      const ei = activeCols.findIndex(c => c.type === 'ref' && c.pos >= e);
      if (si >= 0) {
        const x1 = activePL + si * COL_W;
        const x2 = activePL + ((ei >= 0 ? ei : activeCols.length - 1) + 1) * COL_W;
        ctx.fillStyle = 'rgba(37,99,235,0.10)';
        ctx.fillRect(x1, 0, x2 - x1, totalH);
        ctx.strokeStyle = 'rgba(37,99,235,0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x1, 0, x2 - x1, totalH);
      }
    }

    ctx.restore();
  }, [rows, visibleCols, gene, pdMap, sampleIdxMap, sampleList, sampleInsMap,
      totalH, dragSelection, resolvedIdxMap, computeVisibleCols]);

  // RAF loop: poll scrollRef directly → immediate response without React state
  useEffect(() => {
    let animId;
    let lastSL = -1;
    const loop = () => {
      const sl = scrollRef?.current?.scrollLeft ?? 0;
      if (sl !== lastSL) {
        lastSL = sl;
        draw();
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [draw, scrollRef]);

  // Force redraw on data change
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [draw]);

  // labelPanel is written inline in the return

  // Mouse: tooltip
  const handleMouseMove = useCallback((e) => {
    if (!gene) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { cols: curCols, pL: curPL } = computeVisibleCols();
    const x = e.clientX - rect.left - curPL;
    const y = e.clientY - rect.top;

    const row = rows.find(r => y >= r.y && y < r.y + (r.type === 'group' ? GROUP_H : ROW_H));
    if (!row || row.type !== 'sample') { onLeave(); return; }

    const vi = Math.floor(x / COL_W);
    if (vi < 0 || vi >= curCols.length) { onLeave(); return; }
    const col = curCols[vi];
    if (col) onHover(e, row.sid, col);
  }, [rows, computeVisibleCols, gene, onHover, onLeave]);

  // Mouse: Shift+drag for column selection
  const handleMouseDown = useCallback((e) => {
    if (!e.shiftKey || !onColumnDragEnd) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - padLeft;
    const vi = Math.max(0, Math.min(Math.floor(x / COL_W), visibleCols.length - 1));
    const col = visibleCols[vi];
    if (!col) return;
    const pos = col.type === 'ref' ? col.pos : col.afterPos;
    colDragRef.current = { active: true, startPos: pos, endPos: pos };
    e.stopPropagation();
    e.preventDefault();
  }, [visibleCols, padLeft, onColumnDragEnd]);

  const handleMouseUp = useCallback((e) => {
    if (!colDragRef.current.active) return;
    const { startPos, endPos } = colDragRef.current;
    colDragRef.current = { active: false, startPos: null, endPos: null };
    if (onColumnDragEnd && startPos != null && endPos != null) {
      onColumnDragEnd(Math.min(startPos, endPos), Math.max(startPos, endPos));
    }
  }, [onColumnDragEnd]);

  useEffect(() => {
    const onMove = (e) => {
      if (!colDragRef.current.active) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left - padLeft;
      const vi = Math.max(0, Math.min(Math.floor(x / COL_W), visibleCols.length - 1));
      const col = visibleCols[vi];
      if (col) colDragRef.current.endPos = col.type === 'ref' ? col.pos : col.afterPos;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [visibleCols, padLeft, handleMouseUp]);

  // Compute canvas x offset from scrollLeft
  // The thead table moves with scrollLeft, so canvas must match
  // The vo-scroll div uses overflow:auto to scroll everything
  // SampleCanvas simply sits below the table
  return (
    <div style={{ display: 'flex', width: LABEL_W + totalW, minWidth: LABEL_W + totalW }}>
      {/* Labels */}
      <div style={{
        width: LABEL_W, minWidth: LABEL_W, flexShrink: 0,
        position: 'relative', height: totalH,
        background: '#faf9f6', borderRight: '1px solid #e8e6e0',
        overflow: 'hidden',
      }}>
        {rows.map((row, i) => (
          <div key={i} style={{
            position: 'absolute', top: row.y, left: 0,
            width: LABEL_W,
            height: row.type === 'group' ? GROUP_H : ROW_H,
            display: 'flex', alignItems: 'center',
            background: row.type === 'group' ? (row.group.color + '15') : 'transparent',
            borderLeft: row.type === 'sample' ? `3px solid ${row.color}` : 'none',
            paddingLeft: row.type === 'sample' ? 6 : 5,
            fontSize: row.type === 'group' ? 11 : 10,
            fontWeight: row.type === 'group' ? 700 : 400,
            color: row.type === 'group' ? row.group.color : '#555',
            fontFamily: '"JetBrains Mono", monospace',
            whiteSpace: 'nowrap', overflow: 'hidden',
            boxSizing: 'border-box',
          }}>
            {row.type === 'group'
              ? `${row.group.label}  ·  ${row.group.vis.length}s`
              : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: LABEL_W - 12 }}>
                  {row.sid}
                </span>}
          </div>
        ))}
      </div>
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={onLeave}
        onMouseDown={handleMouseDown}
        style={{ display: 'block', flexShrink: 0 }}
      />
    </div>
  );
}
