/**
 * SampleCanvasWorker.jsx v2
 *
 * - Sits inside the same vo-scroll as the thead table (scroll auto-synced)
 * - Canvas subscribes directly to scrollRef scroll events → Worker postMessage
 * - React re-render happens only on group changes (for label panel updates)
 */

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';

const ROW_H = 20;
const GROUP_H = 22;
const LABEL_W = 130;
const COL_W = 24;

export default function SampleCanvasWorker({
  groups,
  gene,
  msaColumns,       // ← pass the same msaColumns as thead
  totalW,
  viewW,
  scrollLeftRef,
  positionData,
  sampleIdxMap,
  sampleList,
  sampleInsMap,
  onHover,
  onLeave,
  onColumnDragEnd,
  dragSelection,
  scrollRef,
}) {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const initDoneRef = useRef(false);
  const prevGeneIdRef = useRef(null);
  const [totalH, setTotalH] = useState(0);
  const rafRef = useRef(null);
  const colDragRef = useRef({ active: false, startPos: null, endPos: null });

  // ── layout (label panel) ────────────────────────────────────────────────
  const rows = useMemo(() => {
    const r = [];
    let y = 0;
    for (const group of (groups || [])) {
      r.push({ type: 'group', y, group });
      y += GROUP_H;
      for (const sid of group.vis) {
        r.push({ type: 'sample', y, sid, color: group.color });
        y += ROW_H;
      }
    }
    return r;
  }, [groups]);

  const layoutH = useMemo(() => {
    let y = 0;
    for (const g of (groups || [])) y += GROUP_H + g.vis.length * ROW_H;
    return y;
  }, [groups]);

  // ── Create worker ──────────────────────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/sampleWorker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;
    worker.onmessage = (e) => {
      if (e.data.type === 'ready') setTotalH(e.data.totalH);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      initDoneRef.current = false;
    };
  }, []);

  // ── init: reinitialize worker on gene change ───────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!canvas || !worker || !gene || !msaColumns?.length) return;
    // If msaColumns is missing, data is not yet ready
    if (!msaColumns?.length) return;
    if (prevGeneIdRef.current === gene.id && initDoneRef.current) return;

    if (!canvas.transferControlToOffscreen) {
      console.warn('OffscreenCanvas not supported');
      return;
    }

    // Already transferred → cannot reinit; update data via update_msa message
    if (initDoneRef.current) {
      worker.postMessage({
        type: 'update_msa',
        msaColumns,
        scrollLeft: scrollLeftRef?.current ?? 0,
      });
      worker.postMessage({
        type: 'update_groups',
        groups,
        scrollLeft: scrollLeftRef?.current ?? 0,
      });
      prevGeneIdRef.current = gene.id;
      return;
    }

    try {
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({
        type: 'init',
        canvas: offscreen,
        dpr: window.devicePixelRatio || 1,
        msaColumns,
        groups,
        positionData: positionData || [],
        sampleList: sampleList || [],
        sampleIdxMap: sampleIdxMap || {},
        sampleInsMap: sampleInsMap || {},
        geneSeq: gene.seq || '',
        viewW: viewW || 800,
        scrollLeft: scrollLeftRef?.current ?? 0,
      }, [offscreen]);
      initDoneRef.current = true;
      prevGeneIdRef.current = gene.id;
    } catch (err) {
      console.error('Worker init:', err);
    }
  }, [gene?.id, msaColumns?.length, groups?.length]); // eslint-disable-line

  // ── Update worker when msaColumns changes ──────────────────────────────
  useEffect(() => {
    if (!initDoneRef.current || !workerRef.current || !msaColumns?.length) return;
    workerRef.current.postMessage({
      type: 'update_msa',
      msaColumns,
      scrollLeft: scrollLeftRef?.current ?? 0,
    });
  }, [msaColumns]); // eslint-disable-line

  // ── Update worker when groups change ───────────────────────────────────
  useEffect(() => {
    if (!initDoneRef.current || !workerRef.current) return;
    workerRef.current.postMessage({
      type: 'update_groups',
      groups,
      scrollLeft: scrollLeftRef?.current ?? 0,
    });
  }, [groups]); // eslint-disable-line

  // ── scroll event → forwarded to worker (no React state update) ─────────
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const onScroll = () => {
      const sl = el.scrollLeft;
      if (scrollLeftRef) scrollLeftRef.current = sl;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        workerRef.current?.postMessage({ type: 'scroll', scrollLeft: sl });
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); };
  }, [scrollRef, scrollLeftRef]);

  // ── viewW resize ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!initDoneRef.current || !workerRef.current || !viewW) return;
    workerRef.current.postMessage({
      type: 'resize',
      viewW,
      scrollLeft: scrollLeftRef?.current ?? 0,
    });
  }, [viewW]); // eslint-disable-line

  // ── dragSelection highlight ─────────────────────────────────────────────
  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: 'highlight',
      range: dragSelection || null,
      scrollLeft: scrollLeftRef?.current ?? 0,
    });
  }, [dragSelection]); // eslint-disable-line

  // ── Mouse hover: tooltip over canvas area (no label) ───────────────────
  const handleMouseMove = useCallback((e) => {
    if (!gene || !msaColumns?.length) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sl = scrollLeftRef?.current ?? 0;
    // Canvas is pure data area (no label), so x is used as-is
    const x = e.clientX - rect.left + sl;
    const y = e.clientY - rect.top;

    const row = rows.find(r =>
      y >= r.y && y < r.y + (r.type === 'group' ? GROUP_H : ROW_H)
    );
    if (!row || row.type !== 'sample') { onLeave(); return; }

    const ci = Math.floor(x / COL_W);
    const col = msaColumns[ci];
    if (!col) { onLeave(); return; }
    onHover(e, row.sid, col);
  }, [rows, msaColumns, gene, scrollLeftRef, onHover, onLeave]);

  // ── Shift+drag: marker range selection ─────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    if (!e.shiftKey || !onColumnDragEnd || !msaColumns?.length) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sl = scrollLeftRef?.current ?? 0;
    const x = e.clientX - rect.left + sl;
    const ci = Math.max(0, Math.min(Math.floor(x / COL_W), msaColumns.length - 1));
    const col = msaColumns[ci];
    const pos = col?.type === 'ref' ? col.pos : col?.afterPos;
    if (!pos) return;
    colDragRef.current = { active: true, startPos: pos, endPos: pos };
    e.stopPropagation();
    e.preventDefault();
  }, [msaColumns, scrollLeftRef, onColumnDragEnd]);

  useEffect(() => {
    const onMove = (e) => {
      if (!colDragRef.current.active || !msaColumns?.length) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sl = scrollLeftRef?.current ?? 0;
      const x = e.clientX - rect.left + sl;
      const ci = Math.max(0, Math.min(Math.floor(x / COL_W), msaColumns.length - 1));
      const col = msaColumns[ci];
      const pos = col?.type === 'ref' ? col.pos : col?.afterPos;
      if (pos) colDragRef.current.endPos = pos;
    };
    const onUp = () => {
      if (!colDragRef.current.active) return;
      const { startPos, endPos } = colDragRef.current;
      colDragRef.current = { active: false, startPos: null, endPos: null };
      if (startPos && endPos && onColumnDragEnd)
        onColumnDragEnd(Math.min(startPos, endPos), Math.max(startPos, endPos));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [msaColumns, scrollLeftRef, onColumnDragEnd]);

  const h = Math.max(layoutH, totalH, 1);

  // Return canvas only (labels are rendered by GenomeView's SampleLabelCol)
  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: totalW, height: Math.max(layoutH, totalH, 1) }}
      onMouseMove={handleMouseMove}
      onMouseLeave={onLeave}
      onMouseDown={handleMouseDown}
    />
  );
}
