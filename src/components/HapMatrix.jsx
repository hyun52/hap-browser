import React, { useState, useCallback, useRef, useMemo } from 'react';
import { rapdbToLocal } from '../utils/positionUtils.js';
import { getAlleleForSample } from '../utils/haplotype.js';

const geneDataCache = {};
async function fetchGeneData(geneInfo) {
  const id = geneInfo.id;
  if (geneDataCache[id]) return geneDataCache[id];
  const res = await fetch(`data/precomputed/${id}.json`);
  if (!res.ok) throw new Error(`precomputed/${id}.json not found`);
  const pc = await res.json();
  const sampleList = pc.samples || [];
  const sampleIdxMap = {};
  sampleList.forEach((sid, i) => { sampleIdxMap[sid] = i; });
  const positionData = (pc.positionData || []).map(pd => ({
    ...pd,
    hasSnp: !!(pd.f & 1), hasDel: !!(pd.f & 2),
    hasNoCov: !!(pd.f & 4), hasIns: !!(pd.f & 8),
  }));
  const data = { sampleList, sampleIdxMap, positionData };
  geneDataCache[id] = data;
  return data;
}

// Example dummy samples (for phenotype preview)
const DUMMY_SAMPLES = Array.from({length:10}, (_,i) => `SAMPLE_${String(i+1).padStart(3,'0')}`);

// Example data
const EXAMPLE_ROWS = [
  { geneId: 'Os06g0275000', pos: '9338068', end: '' },
  { geneId: 'Os07g0261200', pos: '9152456', end: '' },
  { geneId: 'Os08g0143400', pos: '2388372', end: '' },
];

export default function HapMatrix({ geneIndex, sampleMeta = {}, onClose }) {
  const [rows, setRows] = useState([{ geneId: '', pos: '', end: '' }]);
  const [hapResult, setHapResult] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [phenoText, setPhenoText] = useState('');
  const phenoInputRef = useRef(null);

  const allGenes = useMemo(() => {
    if (!geneIndex) return [];
    if (Array.isArray(geneIndex)) return geneIndex.flatMap(g => g.genes || []);
    if (geneIndex.groups) return geneIndex.groups.flatMap(g => g.genes || []);
    return [];
  }, [geneIndex]);

  const fullReset = () => {
    setRows([{ geneId: '', pos: '', end: '' }]);
    setHapResult(null); setError(''); setPhenoText('');
  };

  const addRow = () => { if (rows.length < 20) setRows(r => [...r, { geneId: '', pos: '', end: '' }]); };
  const removeRow = (i) => setRows(r => r.filter((_, j) => j !== i));
  const updateRow = (i, key, val) => setRows(r => r.map((row, j) => j === i ? { ...row, [key]: val } : row));

  // Load example data
  const loadExample = () => {
    const available = EXAMPLE_ROWS.filter(r => allGenes.find(g => g.id === r.geneId));
    if (available.length) { setRows(available); setHapResult(null); setError(''); }
    else setError('Example gene data is missing. (Hd1, Ghd7, Hd18 required)');
  };

  // Generate random phenotypes
  const generateExamplePheno = () => {
    const samples = hapResult?.commonSamples || DUMMY_SAMPLES;
    const header = 'SampleID\tDTH_2021\tDTH_2022\tPH_2021';
    const lines = samples.map(sid => {
      const base = 70 + Math.random() * 40;
      return `${sid}\t${(base + Math.random()*5).toFixed(1)}\t${(base + Math.random()*5).toFixed(1)}\t${(80 + Math.random()*30).toFixed(1)}`;
    });
    setPhenoText([header, ...lines].join('\n'));
  };

  const parsedPheno = useMemo(() => {
    const src = phenoText.trim();
    if (!src) return null;
    const lines = src.split('\n').map(l => l.split('\t'));
    const header = lines[0];
    if (header.length < 2) return null;
    const traitNames = header.slice(1);
    const data = {};
    for (let i = 1; i < lines.length; i++) {
      const [sid, ...vals] = lines[i];
      if (!sid) continue;
      data[sid] = {};
      traitNames.forEach((t, ti) => { const v = parseFloat(vals[ti]); data[sid][t] = isNaN(v) ? null : v; });
    }
    return { traitNames, data };
  }, [phenoText]);

  const handleCompute = useCallback(async () => {
    setError(''); setHapResult(null); setLoading('Loading gene data...');
    try {
      const validRows = rows.filter(r => r.geneId && r.pos);
      if (!validRows.length) { setError('Please enter at least one position.'); setLoading(''); return; }

      const geneMap = {};
      for (const row of validRows) {
        if (geneMap[row.geneId]) continue;
        const geneInfo = allGenes.find(g => g.id === row.geneId);
        if (!geneInfo) { setError(`Gene not found: ${row.geneId}`); setLoading(''); return; }
        setLoading(`Loading ${geneInfo.sym}...`);
        geneMap[row.geneId] = { info: geneInfo, data: await fetchGeneData(geneInfo) };
      }

      const sampleSets = Object.values(geneMap).map(g => new Set(g.data.sampleList));
      const commonSamples = Object.values(geneMap)[0].data.sampleList
        .filter(s => sampleSets.every(set => set.has(s)));
      if (!commonSamples.length) { setError('No common samples.'); setLoading(''); return; }

      setLoading('Computing haplotypes...');

      // Define columns + collect ref bases
      const columns = validRows.map(row => {
        const geneInfo = geneMap[row.geneId].info;
        const rapPos = parseInt(row.pos.replace(/,|\s/g, ''));
        const localPos = rapdbToLocal(rapPos, geneInfo.offset);
        const localEnd = row.end ? rapdbToLocal(parseInt(row.end.replace(/,|\s/g, '')), geneInfo.offset) : localPos;
        const { data } = geneMap[row.geneId];
        // ref base: take ref of this pos from positionData
        const refPd = data.positionData.find(pd => pd.pos === localPos);
        const refBase = refPd?.ref || geneMap[row.geneId].info?.seq?.[localPos-1] || '?';
        return { geneId: row.geneId, sym: geneInfo.sym, rapPos, localPos, localEnd, refBase };
      });

      // Compute allele per sample
      const patternMap = new Map();
      for (const sid of commonSamples) {
        const parts = columns.map(col => {
          const { data } = geneMap[col.geneId];
          const matchPds = data.positionData.filter(pd =>
            pd.pos >= col.localPos && pd.pos <= col.localEnd &&
            (pd.hasSnp || pd.hasDel || pd.hasIns)
          );
          if (!matchPds.length) return col.refBase || '-';
          const alleles = matchPds.map(pd => {
            const refBase = pd.ref || '-';
            const a = getAlleleForSample(pd, sid, data.sampleList, refBase);
            return a;
          });
          // most frequent allele
          const counts = {};
          alleles.forEach(a => { counts[a] = (counts[a]||0)+1; });
          return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
        });
        const key = parts.join('|');
        if (!patternMap.has(key)) patternMap.set(key, { pattern: parts, samples: [] });
        patternMap.get(key).samples.push(sid);
      }

      const haplotypes = [...patternMap.entries()]
        .sort((a, b) => b[1].samples.length - a[1].samples.length)
        .map(([, v], i) => ({
          id: `Hap${i+1}`, label: `Haplotype ${i+1}`,
          pattern: v.pattern, samples: v.samples, n: v.samples.length,
        }));

      setHapResult({ haplotypes, columns, commonSamples, geneMap });
      setLoading('');
    } catch (e) { setError(e.message); setLoading(''); }
  }, [rows, allGenes]);

  // Compute statistics
  const phenoStats = useMemo(() => {
    if (!hapResult || !parsedPheno) return null;
    return parsedPheno.traitNames.map(trait => ({
      trait,
      haps: hapResult.haplotypes.map(hap => {
        const vals = hap.samples.map(s => parsedPheno.data[s]?.[trait]).filter(v => v != null);
        if (!vals.length) return { id: hap.id, label: hap.label, n: 0, vals: [] };
        vals.sort((a, b) => a - b);
        const mean = vals.reduce((s, v) => s+v, 0) / vals.length;
        const median = vals.length%2===0 ? (vals[vals.length/2-1]+vals[vals.length/2])/2 : vals[Math.floor(vals.length/2)];
        const sd = Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length);
        return { id: hap.id, label: hap.label, n: vals.length,
          min: vals[0].toFixed(2), max: vals[vals.length-1].toFixed(2),
          mean: mean.toFixed(2), median: median.toFixed(2), sd: sd.toFixed(2), vals };
      }),
    }));
  }, [hapResult, parsedPheno]);

  // CSV download — new format
  const downloadCSV = useCallback(() => {
    if (!hapResult) return;
    const { haplotypes, columns } = hapResult;
    const esc = v => { const s = String(v??''); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s; };
    const traitNames = parsedPheno?.traitNames || [];
    const hasMeta = sampleMeta && Object.keys(sampleMeta).length > 0;

    // row1: Haplotype, Samples, [Varieties], [traits], [gene syms]
    const row1 = ['Haplotype', 'Samples',
      ...(hasMeta ? ['Varieties'] : []),
      ...traitNames, ...columns.map(c => c.sym)];
    // row 2: RAP-DB position labels
    const row2 = ['RAP-DB position', '',
      ...(hasMeta ? [''] : []),
      ...traitNames.map(()=>''), ...columns.map(c => c.rapPos)];
    // row 3: Ref. nucleotide labels
    const row3 = ['Ref. nucleotide', '',
      ...(hasMeta ? [''] : []),
      ...traitNames.map(()=>''), ...columns.map(c => c.refBase || '?')];

    const dataRows = haplotypes.map(h => {
      // unique variety list within haplotype (';'-separated)
      const uniqueVarieties = hasMeta
        ? Array.from(new Set(h.samples.map(s => sampleMeta[s]?.variety).filter(Boolean))).join('; ')
        : null;
      const traitVals = traitNames.map(t => {
        const vals = h.samples.map(s => parsedPheno?.data[s]?.[t]).filter(v=>v!=null);
        return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : '';
      });
      const alleles = h.pattern.map((p, i) => p === '-' ? (columns[i]?.refBase || '-') : p);
      return [h.label, h.n,
        ...(hasMeta ? [uniqueVarieties] : []),
        ...traitVals, ...alleles];
    });

    const lines = [
      row1.map(esc).join(','),
      row2.map(esc).join(','),
      row3.map(esc).join(','),
      ...dataRows.map(r => r.map(esc).join(',')),
      '',
      '# Sample-level data',
      ['SampleID',
        ...(hasMeta ? ['Variety'] : []),
        'Haplotype', ...traitNames, ...columns.map(c=>c.sym)].map(esc).join(','),
    ];

    // per-sample rows (with haplotype column)
    haplotypes.forEach(h => {
      h.samples.forEach(sid => {
        const traitVals = traitNames.map(t => parsedPheno?.data[sid]?.[t] ?? '');
        const alleles = h.pattern.map((p, i) => p === '-' ? (columns[i]?.refBase || '-') : p);
        const variety = hasMeta ? (sampleMeta[sid]?.variety || '') : null;
        lines.push([sid,
          ...(hasMeta ? [variety] : []),
          h.label, ...traitVals, ...alleles].map(esc).join(','));
      });
    });

    // statistics section
    if (phenoStats) {
      lines.push('', '# Statistics by Haplotype');
      phenoStats.forEach(ts => {
        lines.push(esc(ts.trait));
        lines.push(['Haplotype','n','Min','Max','Mean','Median','SD'].map(esc).join(','));
        ts.haps.forEach(h => {
          if (h.n > 0) lines.push([h.label||h.id, h.n, h.min, h.max, h.mean, h.median, h.sd].map(esc).join(','));
        });
        lines.push('');
      });
    }

    const blob = new Blob(['\uFEFF'+lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'HapMatrix_result.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [hapResult, parsedPheno, phenoStats, sampleMeta]);

  // Box plot SVG
  // SVG download
  const downloadSVG = (svgId, filename) => {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {type:'image/svg+xml'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = filename + '.svg'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // PNG download
  const downloadPNG = (svgId, filename) => {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    const svgStr = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const scale = 2;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale; canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
      const a = document.createElement('a'); a.href = canvas.toDataURL('image/png');
      a.download = filename + '.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
  };

  // ── Publication-quality box-plot constants ───────────────────────────
  // Okabe-Ito color-blind-safe palette (recommended by Nature)
  const PUB_COLORS = ['#0072B2','#D55E00','#009E73','#CC79A7','#E69F00','#56B4E9','#F0E442','#999999'];
  const PUB_FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";

  // Infer units from trait name
  const inferUnit = (trait) => {
    const t = trait.toUpperCase();
    if (/DTH|DTF|HD|HEADING|FLOWER/.test(t)) return 'days';
    if (/\bPH\b|HEIGHT/.test(t)) return 'cm';
    if (/\bGY\b|YLD|YIELD/.test(t)) return 'g/plant';
    if (/\bTGW|GW\b|GRAIN/.test(t)) return 'g';
    if (/\bPL\b|PANICLE/.test(t)) return 'cm';
    if (/\bTN\b|TILLER/.test(t)) return 'n';
    return null;
  };

  // nice-number tick generator (3-6 ticks)
  const niceTicks = (min, max, targetN = 5) => {
    const range = max - min;
    if (range <= 0) return [min];
    const rough = range / targetN;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
  };

  // Compute stats for a single box (quartiles / whiskers / outliers)
  const computeBoxStats = (hap) => {
    const vals = [...hap.vals].sort((a,b) => a-b);
    const n = vals.length;
    const q = (p) => {
      const idx = (n - 1) * p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return lo === hi ? vals[lo] : vals[lo] * (hi - idx) + vals[hi] * (idx - lo);
    };
    const q1 = q(0.25), q3 = q(0.75), med = parseFloat(hap.median);
    const iqr = q3 - q1;
    const lw = Math.max(vals[0], q1 - 1.5 * iqr);
    const uw = Math.min(vals[n-1], q3 + 1.5 * iqr);
    const outliers = vals.filter(v => v < lw || v > uw);
    return { vals, q1, q3, med, lw, uw, outliers };
  };

  // ── Publication-quality single box plot ──────────────────────────────
  const BoxPlot = ({ stats, trait, svgId }) => {
    const haps = stats.haps.filter(h => h.n > 0);
    if (!haps.length) return null;
    const unit = inferUnit(trait);
    const allVals = haps.flatMap(h => h.vals);
    const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
    const pad = (rawMax - rawMin) * 0.08 || 1;
    const yMin = rawMin - pad, yMax = rawMax + pad;
    const ticks = niceTicks(yMin, yMax, 5);
    const yLo = Math.min(yMin, ticks[0]);
    const yHi = Math.max(yMax, ticks[ticks.length - 1]);
    const yRange = yHi - yLo || 1;

    const W = 560, H = 320;
    const PAD = { t: 36, b: 68, l: 62, r: 18 };
    const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
    const toY = v => PAD.t + plotH - ((v - yLo) / yRange) * plotH;
    const xStep = plotW / haps.length;
    const boxW = Math.min(38, xStep * 0.55);

    const yLabel = unit ? `${trait} (${unit})` : trait;

    return (
      <div style={{ overflowX: 'auto' }}>
        <svg id={svgId} width={W} height={H}
          style={{ fontFamily: PUB_FONT, display: 'block' }}
          xmlns='http://www.w3.org/2000/svg'>
          <rect width={W} height={H} fill='#ffffff'/>

          {/* Title */}
          <text x={W/2} y={22} textAnchor="middle" fill="#1f2937"
            fontSize={13} fontWeight={600} fontFamily={PUB_FONT}>{trait}</text>

          {/* y-axis label */}
          <text x={16} y={PAD.t + plotH/2} textAnchor="middle" fill="#374151"
            fontSize={11} fontWeight={500}
            transform={`rotate(-90, 16, ${PAD.t + plotH/2})`}>
            {yLabel}
          </text>

          {/* horizontal grid + y ticks */}
          {ticks.map((v, i) => {
            const y = toY(v);
            return <g key={i}>
              <line x1={PAD.l} y1={y} x2={W-PAD.r} y2={y}
                stroke="#f3f4f6" strokeWidth={1}/>
              <text x={PAD.l - 8} y={y + 4} textAnchor="end"
                fill="#6b7280" fontSize={10} fontFamily={PUB_FONT}>{v}</text>
            </g>;
          })}

          {/* boxes */}
          {haps.map((h, i) => {
            const { q1, q3, med, lw, uw, outliers } = computeBoxStats(h);
            const cx = PAD.l + xStep*i + xStep/2;
            const col = PUB_COLORS[i % PUB_COLORS.length];
            return <g key={h.id}>
              {/* whisker vertical line */}
              <line x1={cx} y1={toY(lw)} x2={cx} y2={toY(uw)}
                stroke={col} strokeWidth={1.2}/>
              {/* whisker caps */}
              <line x1={cx-boxW/3} y1={toY(lw)} x2={cx+boxW/3} y2={toY(lw)}
                stroke={col} strokeWidth={1.2}/>
              <line x1={cx-boxW/3} y1={toY(uw)} x2={cx+boxW/3} y2={toY(uw)}
                stroke={col} strokeWidth={1.2}/>
              {/* box */}
              <rect x={cx-boxW/2} y={toY(q3)} width={boxW}
                height={Math.max(1, toY(q1)-toY(q3))}
                fill={col} fillOpacity={0.35}
                stroke={col} strokeWidth={1.4}/>
              {/* median line (white for contrast) */}
              <line x1={cx-boxW/2} y1={toY(med)} x2={cx+boxW/2} y2={toY(med)}
                stroke="#ffffff" strokeWidth={2.4}/>
              <line x1={cx-boxW/2} y1={toY(med)} x2={cx+boxW/2} y2={toY(med)}
                stroke={col} strokeWidth={1.2}/>
              {/* outliers */}
              {outliers.map((v,oi) =>
                <circle key={oi} cx={cx} cy={toY(v)} r={2.2}
                  fill="#ffffff" stroke={col} strokeWidth={1.2}/>
              )}
              {/* hap id */}
              <text x={cx} y={H-PAD.b+18} textAnchor="middle"
                fill="#1f2937" fontSize={11} fontWeight={600} fontFamily={PUB_FONT}>{h.id}</text>
              {/* n */}
              <text x={cx} y={H-PAD.b+34} textAnchor="middle"
                fill="#6b7280" fontSize={10} fontFamily={PUB_FONT}
                fontStyle="italic">n = {h.n}</text>
            </g>;
          })}

          {/* axis line */}
          <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H-PAD.b}
            stroke="#9ca3af" strokeWidth={1}/>
          <line x1={PAD.l} y1={H-PAD.b} x2={W-PAD.r} y2={H-PAD.b}
            stroke="#9ca3af" strokeWidth={1}/>
        </svg>
      </div>
    );
  };

  // ── Publication-quality multi-trait panel ─────────────────────────────
  // Subplot grid with independent y-axis per trait.
  // Each trait preserves its own scale → heterogeneous traits like DTH(days) and PH(cm) can be shown together.
  const CombinedBoxPlot = ({ phenoStats, svgId }) => {
    const traits = phenoStats.filter(ts => ts.haps.some(h => h.n > 0));
    if (!traits.length) return null;
    const nT = traits.length;

    // Grid layout: up to 3 columns
    const NCOL = Math.min(3, nT);
    const NROW = Math.ceil(nT / NCOL);

    // Size of each subplot
    const SUB_W = 360, SUB_H = 280;
    const GAP_X = 18, GAP_Y = 24;
    const TITLE_H = 34;   // top header
    const LEG_H = 36;     // bottom legend

    const W = NCOL * SUB_W + (NCOL - 1) * GAP_X + 30;
    const H = TITLE_H + NROW * SUB_H + (NROW - 1) * GAP_Y + LEG_H + 10;

    const PAD = { t: 28, b: 52, l: 58, r: 14 };

    // Collect all haplotype ids (for legend)
    const allHapIds = Array.from(new Set(
      traits.flatMap(ts => ts.haps.filter(h => h.n > 0).map(h => h.id))
    ));

    return (
      <div style={{ overflowX: 'auto' }}>
        <svg id={svgId} width={W} height={H}
          style={{ fontFamily: PUB_FONT, display: 'block' }}
          xmlns='http://www.w3.org/2000/svg'>
          <rect width={W} height={H} fill='#ffffff'/>

          {/* Overall title */}
          <text x={W/2} y={20} textAnchor="middle" fill="#111827"
            fontSize={14} fontWeight={600} fontFamily={PUB_FONT}>
            Haplotype–phenotype association across traits
          </text>

          {/* Subplots */}
          {traits.map((ts, ti) => {
            const row = Math.floor(ti / NCOL), col = ti % NCOL;
            const ox = 15 + col * (SUB_W + GAP_X);
            const oy = TITLE_H + row * (SUB_H + GAP_Y);

            const haps = ts.haps.filter(h => h.n > 0);
            const unit = inferUnit(ts.trait);
            const allVals = haps.flatMap(h => h.vals);
            const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
            const pad = (rawMax - rawMin) * 0.08 || 1;
            const ticks = niceTicks(rawMin - pad, rawMax + pad, 4);
            const yLo = Math.min(rawMin - pad, ticks[0]);
            const yHi = Math.max(rawMax + pad, ticks[ticks.length - 1]);
            const yRange = yHi - yLo || 1;

            const plotW = SUB_W - PAD.l - PAD.r;
            const plotH = SUB_H - PAD.t - PAD.b;
            const toY = v => oy + PAD.t + plotH - ((v - yLo) / yRange) * plotH;
            const xStep = plotW / haps.length;
            const boxW = Math.min(28, xStep * 0.5);

            const yLabel = unit ? `${ts.trait} (${unit})` : ts.trait;

            return (
              <g key={ts.trait}>
                {/* Subplot title */}
                <text x={ox + SUB_W/2} y={oy + 14} textAnchor="middle"
                  fill="#1f2937" fontSize={12} fontWeight={600} fontFamily={PUB_FONT}>
                  {ts.trait}
                </text>

                {/* y-axis label */}
                <text x={ox + 14} y={oy + PAD.t + plotH/2} textAnchor="middle"
                  fill="#374151" fontSize={10} fontWeight={500}
                  transform={`rotate(-90, ${ox+14}, ${oy + PAD.t + plotH/2})`}>
                  {yLabel}
                </text>

                {/* y tick + grid */}
                {ticks.map((v, j) => {
                  const y = toY(v);
                  return <g key={j}>
                    <line x1={ox+PAD.l} y1={y} x2={ox+SUB_W-PAD.r} y2={y}
                      stroke="#f3f4f6" strokeWidth={1}/>
                    <text x={ox+PAD.l-6} y={y+3} textAnchor="end"
                      fill="#6b7280" fontSize={9} fontFamily={PUB_FONT}>{v}</text>
                  </g>;
                })}

                {/* boxes */}
                {haps.map((h, i) => {
                  const { q1, q3, med, lw, uw, outliers } = computeBoxStats(h);
                  const cx = ox + PAD.l + xStep*i + xStep/2;
                  // Color by haplotype id so it matches the legend order
                  const colIdx = allHapIds.indexOf(h.id);
                  const col = PUB_COLORS[colIdx % PUB_COLORS.length];
                  return <g key={h.id}>
                    <line x1={cx} y1={toY(lw)} x2={cx} y2={toY(uw)}
                      stroke={col} strokeWidth={1.1}/>
                    <line x1={cx-boxW/3} y1={toY(lw)} x2={cx+boxW/3} y2={toY(lw)}
                      stroke={col} strokeWidth={1.1}/>
                    <line x1={cx-boxW/3} y1={toY(uw)} x2={cx+boxW/3} y2={toY(uw)}
                      stroke={col} strokeWidth={1.1}/>
                    <rect x={cx-boxW/2} y={toY(q3)} width={boxW}
                      height={Math.max(1, toY(q1)-toY(q3))}
                      fill={col} fillOpacity={0.35}
                      stroke={col} strokeWidth={1.2}/>
                    <line x1={cx-boxW/2} y1={toY(med)} x2={cx+boxW/2} y2={toY(med)}
                      stroke="#ffffff" strokeWidth={2.2}/>
                    <line x1={cx-boxW/2} y1={toY(med)} x2={cx+boxW/2} y2={toY(med)}
                      stroke={col} strokeWidth={1}/>
                    {outliers.map((v,oi) =>
                      <circle key={oi} cx={cx} cy={toY(v)} r={1.8}
                        fill="#ffffff" stroke={col} strokeWidth={1}/>
                    )}
                    <text x={cx} y={oy + SUB_H - PAD.b + 14} textAnchor="middle"
                      fill="#1f2937" fontSize={10} fontWeight={600} fontFamily={PUB_FONT}>
                      {h.id}
                    </text>
                    <text x={cx} y={oy + SUB_H - PAD.b + 27} textAnchor="middle"
                      fill="#6b7280" fontSize={9} fontFamily={PUB_FONT}
                      fontStyle="italic">n={h.n}</text>
                  </g>;
                })}

                {/* axis line */}
                <line x1={ox+PAD.l} y1={oy+PAD.t}
                  x2={ox+PAD.l} y2={oy + SUB_H - PAD.b}
                  stroke="#9ca3af" strokeWidth={1}/>
                <line x1={ox+PAD.l} y1={oy + SUB_H - PAD.b}
                  x2={ox + SUB_W - PAD.r} y2={oy + SUB_H - PAD.b}
                  stroke="#9ca3af" strokeWidth={1}/>
              </g>
            );
          })}

          {/* Shared legend (bottom-center) */}
          <g>
            {(() => {
              const legItemW = 70;
              const legTotalW = allHapIds.length * legItemW;
              const legX = (W - legTotalW) / 2;
              const legY = H - LEG_H + 14;
              return allHapIds.map((hid, i) => (
                <g key={hid} transform={`translate(${legX + i*legItemW}, ${legY})`}>
                  <rect x={0} y={0} width={14} height={10}
                    fill={PUB_COLORS[i % PUB_COLORS.length]} fillOpacity={0.45}
                    stroke={PUB_COLORS[i % PUB_COLORS.length]} strokeWidth={1.2}/>
                  <text x={19} y={9} fill="#1f2937" fontSize={11}
                    fontFamily={PUB_FONT}>{hid}</text>
                </g>
              ));
            })()}
          </g>
        </svg>
      </div>
    );
  };

  const thSt = { padding:'5px 10px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--t1)', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap', background:'var(--bg3)' };
  const tdSt = { padding:'4px 10px', fontSize:11 };

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg1)', color:'var(--t0)', fontFamily:'var(--sans)' }}>
      {/* Header */}
      <div style={{ background:'var(--bg2)', borderBottom:'1px solid var(--border)', padding:'10px 24px', display:'flex', alignItems:'center', gap:16, position:'sticky', top:0, zIndex:100 }}>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', fontSize:18, lineHeight:1, padding:'0 4px' }}>←</button>
        <span style={{ fontWeight:700, fontSize:15 }}>🧬 HapMatrix</span>
        <span style={{ fontSize:11, color:'var(--t2)' }}>Cross-gene haplotype analysis</span>
      </div>

      <div style={{ maxWidth:980, margin:'0 auto', padding:'24px 16px', display:'flex', flexDirection:'column', gap:20 }}>

        {/* ① Gene Positions */}
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, padding:18 }}>
          <div style={{ fontWeight:700, fontSize:12, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>
            Gene Positions
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {rows.map((row, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:10, color:'var(--t2)', width:28, flexShrink:0 }}>#{i+1}</span>
                <select value={row.geneId} onChange={e => updateRow(i,'geneId',e.target.value)}
                  style={{ fontSize:12, padding:'3px 6px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg1)', color:'var(--t0)', minWidth:110 }}>
                  <option value="">— Gene —</option>
                  {allGenes.map(g => <option key={g.id} value={g.id}>{g.sym}</option>)}
                </select>
                <input type="text" placeholder="RAP-DB pos"
                  value={row.pos} onChange={e => updateRow(i,'pos',e.target.value)}
                  style={{ fontSize:12, padding:'3px 6px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg1)', color:'var(--t0)', width:120 }}/>
                <span style={{ fontSize:11, color:'var(--t2)' }}>~</span>
                <input type="text" placeholder="end (optional)"
                  value={row.end} onChange={e => updateRow(i,'end',e.target.value)}
                  style={{ fontSize:12, padding:'3px 6px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg1)', color:'var(--t0)', width:110 }}/>
                {rows.length > 1 && (
                  <button onClick={() => removeRow(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t2)', fontSize:14, padding:'0 4px' }}>✕</button>
                )}
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:8, marginTop:10, alignItems:'center' }}>
            {rows.length < 20 && (
              <button onClick={addRow} style={{ fontSize:11, padding:'3px 10px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg3)', color:'var(--t1)', cursor:'pointer' }}>
                + Add
              </button>
            )}
            <button onClick={loadExample}
              style={{ fontSize:11, padding:'3px 10px', border:'1px dashed var(--accent)', borderRadius:4, background:'none', color:'var(--accent)', cursor:'pointer' }}>
              Example
            </button>
            <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
              <button onClick={fullReset}
                style={{ fontSize:11, padding:'4px 12px', border:'1px solid #fca5a5', borderRadius:4, background:'#fef2f2', color:'#ef4444', cursor:'pointer' }}>
                🗑 Full Reset
              </button>
              <button onClick={handleCompute} disabled={!!loading}
                style={{ fontSize:12, padding:'5px 20px', border:'none', borderRadius:4, background:loading?'var(--bg3)':'var(--accent)', color:loading?'var(--t2)':'#fff', cursor:loading?'default':'pointer', fontWeight:600 }}>
                {loading || 'Compute Haplotypes'}
              </button>
            </div>
          </div>
          {error && <div style={{ marginTop:8, fontSize:11, color:'#ef4444' }}>⚠ {error}</div>}
        </div>

        {/* ② Haplotype results */}
        {hapResult && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, padding:18 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div style={{ fontWeight:700, fontSize:12, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.5px' }}>
                Haplotypes — {hapResult.haplotypes.length} types · {hapResult.commonSamples.length} samples
              </div>
              <button onClick={downloadCSV}
                style={{ fontSize:11, padding:'3px 12px', border:'none', borderRadius:4, background:'var(--accent)', color:'#fff', cursor:'pointer', fontWeight:600 }}>
                ⬇ Download CSV
              </button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ borderCollapse:'collapse', fontSize:11, width:'100%' }}>
                <thead>
                  <tr>
                    <th style={thSt}>Haplotype</th>
                    <th style={thSt}>n</th>
                    {hapResult.columns.map((c, i) => (
                      <th key={i} style={thSt}>
                        {c.sym}<br/>
                        <span style={{ fontWeight:400, color:'var(--t2)', fontSize:10 }}>{c.rapPos.toLocaleString()}</span><br/>
                        <span style={{ fontWeight:400, color:'#16a34a', fontSize:10 }}>ref:{c.refBase}</span>
                      </th>
                    ))}
                    <th style={{...thSt, maxWidth:160}}>Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {hapResult.haplotypes.map((h, i) => (
                    <tr key={h.id} style={{ borderBottom:'1px solid var(--border)', background:i%2?'var(--bg1)':'var(--bg2)' }}>
                      <td style={tdSt}><b>{h.label}</b></td>
                      <td style={{ ...tdSt, textAlign:'center', color:'var(--accent)', fontWeight:600 }}>{h.n}</td>
                      {h.pattern.map((p, j) => {
                        const isRef = p === hapResult.columns[j]?.refBase;
                        return (
                          <td key={j} style={{ ...tdSt, textAlign:'center', fontFamily:'var(--mono)', fontWeight:600,
                            color: p==='-'?'var(--t3)': isRef?'#16a34a':'#ef4444' }}>
                            {p === '-' ? hapResult.columns[j]?.refBase : p}
                          </td>
                        );
                      })}
                      <td style={{ ...tdSt, color:'var(--t2)', fontSize:10, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {h.samples.slice(0,3).join(', ')}{h.n>3?` +${h.n-3} more`:''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ③ Phenotype input */}
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, padding:18 }}>
          <div style={{ fontWeight:700, fontSize:12, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>
            Phenotype Data <span style={{ fontWeight:400, fontSize:10, textTransform:'none' }}>(optional)</span>
          </div>
          <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center', flexWrap:'wrap' }}>
            <button onClick={() => phenoInputRef.current?.click()}
              style={{ fontSize:11, padding:'3px 10px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg3)', color:'var(--t1)', cursor:'pointer' }}>
              📂 Upload TSV
            </button>
            <input ref={phenoInputRef} type="file" accept=".tsv,.txt,.csv" style={{ display:'none' }}
              onChange={e => { const f=e.target.files?.[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setPhenoText(ev.target.result); r.readAsText(f); }}/>
            <button onClick={generateExamplePheno}
              style={{ fontSize:11, padding:'3px 10px', border:'1px dashed #f59e0b', borderRadius:4, background:'none', color:'#d97706', cursor:'pointer' }}>
              🎲 Generate Example
            </button>
            <span style={{ fontSize:10, color:'var(--t3)' }}>or paste below (TSV: SampleID + trait columns)</span>
            {phenoText && (
              <button onClick={() => setPhenoText('')}
                style={{ fontSize:10, padding:'2px 8px', border:'1px solid var(--border)', borderRadius:4, background:'none', color:'var(--t2)', cursor:'pointer' }}>
                Clear
              </button>
            )}
          </div>
          <textarea value={phenoText} onChange={e => setPhenoText(e.target.value)}
            placeholder={'SampleID\tDTH_2021\tDTH_2022\nERS467761\t85.3\t88.1\n...'}
            style={{ width:'100%', height:90, fontSize:11, fontFamily:'var(--mono)', padding:8,
              border:'1px solid var(--border)', borderRadius:4, background:'var(--bg1)', color:'var(--t0)',
              resize:'vertical', boxSizing:'border-box' }}/>
          {parsedPheno && (
            <div style={{ marginTop:6, fontSize:11, color:'#16a34a' }}>
              ✓ {Object.keys(parsedPheno.data).length} samples · {parsedPheno.traitNames.length} traits: {parsedPheno.traitNames.join(', ')}
            </div>
          )}
        </div>

        {/* ④ Statistics + box plot */}
        {phenoStats && phenoStats.map((ts, ti) => {
          const svgId = `boxplot-${ti}`;
          return (
          <div key={ts.trait} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, padding:18 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ fontWeight:700, fontSize:12, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.5px' }}>
                {ts.trait}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <button onClick={() => downloadSVG(svgId, `HapMatrix_${ts.trait}`)}
                  style={{ fontSize:10, padding:'2px 8px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg3)', color:'var(--t1)', cursor:'pointer' }}>
                  ⬇ SVG
                </button>
                <button onClick={() => downloadPNG(svgId, `HapMatrix_${ts.trait}`)}
                  style={{ fontSize:10, padding:'2px 8px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg3)', color:'var(--t1)', cursor:'pointer' }}>
                  ⬇ PNG
                </button>
              </div>
            </div>
            <div style={{ display:'flex', gap:24, flexWrap:'wrap', alignItems:'flex-start' }}>
              <div style={{ overflowX:'auto', flex:'0 0 auto' }}>
                <table style={{ borderCollapse:'collapse', fontSize:11 }}>
                  <thead>
                    <tr>
                      {['Haplotype','n','Min','Max','Mean','Median','SD'].map(h => (
                        <th key={h} style={thSt}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ts.haps.filter(h=>h.n>0).map((h,i) => (
                      <tr key={h.id} style={{ borderBottom:'1px solid var(--border)', background:i%2?'var(--bg1)':'var(--bg2)' }}>
                        <td style={tdSt}><b>{h.label||h.id}</b></td>
                        <td style={{...tdSt,textAlign:'center'}}>{h.n}</td>
                        <td style={{...tdSt,textAlign:'right',fontFamily:'var(--mono)'}}>{h.min}</td>
                        <td style={{...tdSt,textAlign:'right',fontFamily:'var(--mono)'}}>{h.max}</td>
                        <td style={{...tdSt,textAlign:'right',fontFamily:'var(--mono)'}}>{h.mean}</td>
                        <td style={{...tdSt,textAlign:'right',fontFamily:'var(--mono)'}}>{h.median}</td>
                        <td style={{...tdSt,textAlign:'right',fontFamily:'var(--mono)'}}>{h.sd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <BoxPlot stats={ts} trait={ts.trait} svgId={svgId}/>
            </div>
          </div>
          );
        })}

        {/* ⑤ Multi-trait panel */}
        {phenoStats && phenoStats.length > 1 && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, padding:18 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:12, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.5px' }}>
                  Multi-trait panel
                </div>
                <div style={{ fontSize:10, color:'var(--t2)', marginTop:3, fontWeight:400, textTransform:'none', letterSpacing:0 }}>
                  Independent y-axis per trait · each trait preserves its own scale
                </div>
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <button onClick={() => downloadSVG('boxplot-combined', 'HapMatrix_multitrait')}
                  style={{ fontSize:10, padding:'2px 8px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg3)', color:'var(--t1)', cursor:'pointer' }}>
                  ⬇ SVG
                </button>
                <button onClick={() => downloadPNG('boxplot-combined', 'HapMatrix_multitrait')}
                  style={{ fontSize:10, padding:'2px 8px', border:'1px solid var(--border)', borderRadius:4, background:'var(--bg3)', color:'var(--t1)', cursor:'pointer' }}>
                  ⬇ PNG
                </button>
              </div>
            </div>
            <CombinedBoxPlot phenoStats={phenoStats} svgId="boxplot-combined"/>
          </div>
        )}

      </div>
    </div>
  );
}
