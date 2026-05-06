/**
 * sampleWorker.js v2 - simplified worker
 * Takes the entire msaColumns array and draws by index
 */

const COL_W = 24;
const ROW_H = 20;
const GROUP_H = 22;
const FONT = '11px "JetBrains Mono", monospace';
const FONT_SM = '9px "JetBrains Mono", monospace';
const BUFFER = 25;

const C = {
  nocov: '#e2e0db', del: '#c8c5be',
  A: '#1d6fba', T: '#15803d', G: '#b35a00', C: '#c41c1c',
  dot: '#bbb', ins: '#ede9fe',
};

let canvas = null, ctx = null, dpr = 1;
let msaColumns = [];   // { type:'ref'|'ins', pos?, afterPos?, insIdx? }[]
let pdMap = new Map(); // pos → positionData
let sampleIdxMap = {};
let sampleList = [];
let sampleInsMap = {};
let geneSeq = '';
let groups = [];
let rows = [];
let totalH = 0;
let viewW = 800;
let highlight = null;

// ── Build layout ───────────────────────────────────────────────────────────
function buildLayout() {
  rows = [];
  let y = 0;
  for (const g of groups) {
    rows.push({ type: 'group', y, group: g });
    y += GROUP_H;
    for (const sid of g.vis) {
      rows.push({ type: 'sample', y, sid, color: g.color });
      y += ROW_H;
    }
  }
  totalH = y;
}

// ── Allele lookup ──────────────────────────────────────────────────────────
function getAllele(pd, si, refBase) {
  if (!pd) return refBase;
  if (pd.enc !== undefined) {
    if (si < 0 || si >= pd.enc.length) return refBase;
    const c = pd.enc[si];
    if (c === '0') return refBase;
    if (c === '-') return '-';
    const altIdx = parseInt(c) - 1;
    return altIdx < (pd.alt||[]).length ? pd.alt[altIdx] : refBase;
  }
  if (pd.alleles) {
    const sid = sampleList[si];
    return sid ? (pd.alleles[sid] ?? refBase) : refBase;
  }
  return refBase;
}

// ── Canvas sizing ──────────────────────────────────────────────────────────
function resizeCanvas() {
  if (!canvas) return;
  const W = viewW;
  const H = Math.max(totalH, 1);
  const tw = Math.round(W * dpr);
  const th = Math.round(H * dpr);
  if (canvas.width !== tw || canvas.height !== th) {
    canvas.width = tw;
    canvas.height = th;
  }
}

// ── Drawing ────────────────────────────────────────────────────────────────
function draw(scrollLeft) {
  if (!canvas || !ctx || !rows.length || !msaColumns.length) return;

  const W = canvas.width / dpr;
  const H = canvas.height / dpr;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Compute visible column range
  const startIdx = Math.max(0, Math.floor(scrollLeft / COL_W) - BUFFER);
  const endIdx = Math.min(msaColumns.length - 1,
    Math.ceil((scrollLeft + W) / COL_W) + BUFFER);

  for (const row of rows) {
    const { y } = row;
    if (y + ROW_H < 0 || y > H) continue;

    if (row.type === 'group') {
      ctx.fillStyle = row.group.color + '15';
      ctx.fillRect(0, y, W, GROUP_H);
      continue;
    }

    const { sid } = row;
    const si = sampleIdxMap[sid] ?? -1;

    for (let ci = startIdx; ci <= endIdx; ci++) {
      const col = msaColumns[ci];
      if (!col) continue;

      // x within canvas = absolute column position - scrollLeft
      const cx = ci * COL_W - scrollLeft;
      if (cx + COL_W < 0 || cx > W) continue;

      if (col.type === 'ins') {
        const insSeq = sampleInsMap[sid]?.[col.afterPos] || '';
        const b = insSeq[col.insIdx] || '';
        if (b) {
          ctx.fillStyle = C.ins;
          ctx.fillRect(cx, y, COL_W - 1, ROW_H - 1);
          ctx.fillStyle = C[b] || '#7c3aed';
          ctx.fillText(b, cx + COL_W / 2, y + ROW_H / 2);
        }
        continue;
      }

      // ref column
      const pos = col.pos;
      const refBase = geneSeq[pos - 1] || 'N';
      const pd = pdMap.get(pos);
      const allele = getAllele(pd, si, refBase);

      if (allele === '-') {
        ctx.fillStyle = C.nocov;
        ctx.fillRect(cx, y, COL_W - 1, ROW_H - 1);
        continue;
      }
      if (allele === 'D') {
        ctx.fillStyle = C.del;
        ctx.fillRect(cx, y, COL_W - 1, ROW_H - 1);
        ctx.strokeStyle = '#9a9690';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + 4, y + ROW_H / 2);
        ctx.lineTo(cx + COL_W - 5, y + ROW_H / 2);
        ctx.stroke();
        continue;
      }

      const baseChar = allele.includes('+') ? allele[0] : allele;
      const isRef = baseChar === refBase && !allele.includes('+');

      if (isRef) {
        ctx.fillStyle = C.dot;
        ctx.fillText('·', cx + COL_W / 2, y + ROW_H / 2);
        continue;
      }

      ctx.fillStyle = C[baseChar] || '#666';
      ctx.fillRect(cx, y, COL_W - 1, ROW_H - 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(baseChar, cx + COL_W / 2, y + ROW_H / 2);

      if (allele.includes('+')) {
        ctx.fillStyle = '#c4b5fd';
        ctx.font = FONT_SM;
        ctx.fillText('+', cx + COL_W - 5, y + 7);
        ctx.font = FONT;
      }
    }
  }

  // drag highlight
  if (highlight) {
    const { startPos, endPos } = highlight;
    const s = Math.min(startPos, endPos);
    const e = Math.max(startPos, endPos);
    let x1 = -1, x2 = -1;
    for (let ci = 0; ci < msaColumns.length; ci++) {
      const col = msaColumns[ci];
      if (col.type !== 'ref') continue;
      if (col.pos >= s && x1 < 0) x1 = ci * COL_W - scrollLeft;
      if (col.pos >= e) { x2 = (ci + 1) * COL_W - scrollLeft; break; }
    }
    if (x1 >= 0) {
      if (x2 < 0) x2 = msaColumns.length * COL_W - scrollLeft;
      ctx.fillStyle = 'rgba(37,99,235,0.10)';
      ctx.fillRect(x1, 0, x2 - x1, totalH);
      ctx.strokeStyle = 'rgba(37,99,235,0.45)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x1, 0, x2 - x1, totalH);
    }
  }

  ctx.restore();
}

// ── Message handler ────────────────────────────────────────────────────────
self.onmessage = (e) => {
  const { type, ...data } = e.data;

  switch (type) {
    case 'init': {
      canvas = data.canvas;
      dpr = data.dpr || 1;
      ctx = canvas.getContext('2d');

      msaColumns = data.msaColumns || [];
      groups = data.groups || [];
      sampleIdxMap = data.sampleIdxMap || {};
      sampleList = data.sampleList || [];
      sampleInsMap = data.sampleInsMap || {};
      geneSeq = data.geneSeq || '';
      viewW = data.viewW || 800;

      pdMap = new Map();
      for (const pd of (data.positionData || [])) pdMap.set(pd.pos, pd);

      buildLayout();
      resizeCanvas();
      draw(data.scrollLeft || 0);
      self.postMessage({ type: 'ready', totalH });
      break;
    }
    case 'scroll': {
      draw(data.scrollLeft);
      break;
    }
    case 'update_groups': {
      groups = data.groups || [];
      buildLayout();
      resizeCanvas();
      draw(data.scrollLeft || 0);
      self.postMessage({ type: 'ready', totalH });
      break;
    }
    case 'highlight': {
      highlight = data.range || null;
      draw(data.scrollLeft || 0);
      break;
    }
    case 'resize': {
      viewW = data.viewW || viewW;
      resizeCanvas();
      draw(data.scrollLeft || 0);
      break;
    }
    case 'update_msa': {
      msaColumns = data.msaColumns || [];
      draw(data.scrollLeft || 0);
      break;
    }
  }
};
