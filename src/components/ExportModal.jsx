import React, { useState, useCallback } from 'react';
import { localToRapdb } from '../utils/positionUtils.js';
import { getAlleleForSample } from '../utils/haplotype.js';
import { classifyPosition, REGION_LBL } from '../utils/annotation.js';

export default function ExportModal({
  gene, hapData, positionData, shownSamples, posMode,
  sampleList, msaColumns, sampleInsMap,
  viewRegion, viewFlags, showProtein, sampleMeta = {}, onClose
}) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus]     = useState('');
  const [running, setRunning]   = useState(false);

  const tick = () => new Promise(r => setTimeout(r, 0));

  const handleExport = useCallback(async (filterNonSyn = false) => {
    if (!gene || !hapData || running) return;
    setRunning(true); setProgress(2); setStatus('Preparing...');

    try {
      const offset = gene.offset;
      const pdMap  = new Map();
      (positionData || []).forEach(pd => pdMap.set(pd.pos, pd));

      const cols = (msaColumns || []);
      if (!cols.length) { setStatus('No columns found.'); setRunning(false); return; }

      const esc = v => {
        const s = String(v ?? '');
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
          ? `"${s.replace(/"/g, '""')}"` : s;
      };

      // 1. colCache: pure metadata only (no getCachedAltRatio)
      const colCache = cols.map(col => {
        if (col.type === 'ref') {
          return { ...col, pd: pdMap.get(col.pos), refBase: gene.seq[col.pos - 1] || 'N' };
        }
        return col;
      });

      // 2. Sample list
      const shownSet = new Set(shownSamples || []);
      const visHaps  = hapData.haplotypes.map(h => ({
        ...h, vis: h.samples.filter(s => shownSet.has(s))
      })).filter(h => h.vis.length > 0);
      const totalSamples = visHaps.reduce((s, h) => s + h.vis.length, 0);

      // alt-count array
      const altSampleCounts = new Array(colCache.length).fill(0);
      const altAlleleCounts = colCache.map(() => ({})); // idx → { allele: count }
      const sampleLines = [];
      let processedSamples = 0;
      let lastYieldTime = performance.now();

      setProgress(5); setStatus(`Writing samples... 0/${totalSamples}`);
      await tick();

      // 3. Build sample data while accumulating alt counts
      for (const hap of visHaps) {
        for (const sid of hap.vis) {
          const variety = sampleMeta?.[sid]?.variety || '';
          const rowData = [hap.id, sid, variety]; // hap, sample, variety
          const rowCols = []; // per-column values (filtered later)

          colCache.forEach((col, idx) => {
            if (col.type === 'ref') {
              const raw = col.pd
                ? (getAlleleForSample(col.pd, sid, sampleList, col.refBase) || col.refBase)
                : col.refBase;
              const allele = raw.includes('+') ? raw.split('+')[0] : raw;
              rowCols.push({ idx, val: allele });
              if (allele !== col.refBase) {
                altSampleCounts[idx]++;
                altAlleleCounts[idx][allele] = (altAlleleCounts[idx][allele] || 0) + 1;
              }
            } else {
              const fullIns = sampleInsMap?.[sid]?.[col.afterPos];
              const char = (fullIns && fullIns.length > col.insIdx) ? fullIns[col.insIdx] : '-';
              rowCols.push({ idx, val: char });
              if (char !== '-') altSampleCounts[idx]++;
            }
          });

          sampleLines.push({ rowData, rowCols });
          processedSamples++;

          if (performance.now() - lastYieldTime > 30) {
            setProgress(5 + Math.floor(processedSamples / totalSamples * 88));
            setStatus(`Writing samples... ${processedSamples}/${totalSamples}`);
            await tick();
            lastYieldTime = performance.now();
          }
        }
      }

      // 4. Assemble header (after counting)
      setProgress(95); setStatus('Building headers...'); await tick();

      // sample rows gained a variety column, so header rows need a third blank cell
      // row 1 col 3 is the 'Variety' label; others are blank (label rows live in annotation col 2)
      const row1 = ['Haplotype', 'Annotation', 'Variety'];
      const row2 = ['', posMode === 'rapdb' ? 'RAP-DB position' : 'Local position', ''];
      const row3 = ['', 'Reference nucleotide', ''];
      const row3b = ['', 'Alt nucleotide', ''];
      const row4 = ['', 'Alt sample', ''];

      // protein rows (only when showProtein)
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
      const COMP = {A:'T',T:'A',G:'C',C:'G'};
      const comp = b => COMP[b.toUpperCase()] || b;

      const cdsMap = showProtein && gene?.cdsMap
        ? new Map(Object.entries(gene.cdsMap).map(([k,v]) => [parseInt(k), v]))
        : new Map();

      // pos → codon group cache (groups the three positions of each codon)
      const codonCache = new Map(); // cn → { positions, refAA, refCodon }
      if (showProtein && cdsMap.size) {
        const isMinus = gene?.strand === '-';
        cdsMap.forEach((info, pos) => {
          const { cn } = info;
          if (!codonCache.has(cn)) {
            // Collect all positions sharing this codon number
            const codonPositions = [];
            cdsMap.forEach((v2, p2) => { if (v2.cn === cn) codonPositions.push(p2); });
            codonPositions.sort((a, b) => a - b);
            const ordered = isMinus ? [...codonPositions].reverse() : codonPositions;
            const refBases = ordered.map(p => {
              const base = (gene.seq[p - 1] || 'N').toUpperCase();
              return isMinus ? comp(base) : base;
            });
            const refCodon = refBases.join('');
            const refAA = GENETIC_CODE[refCodon] || '?';
            codonCache.set(cn, { positions: codonPositions, refCodon, refAA });
          }
        });
      }

      // Compute protein meta for each column
      const colProtein = colCache.map(col => {
        if (!showProtein || col.type !== 'ref' || !cdsMap.has(col.pos)) return null;
        const info = cdsMap.get(col.pos);
        const codon = codonCache.get(info.cn);
        if (!codon) return null;
        // Per-sample alt codon
        const isMinus = gene?.strand === '-';
        const ordered = isMinus ? [...codon.positions].reverse() : codon.positions;
        const altAAs = new Set();
        let synonymous = 0, nonsyn = 0, frameshift = 0;
        const shownSet2 = new Set(shownSamples || []);
        for (const sid of (sampleList || [])) {
          if (!shownSet2.has(sid)) continue;
          const bases = ordered.map(p => {
            const pd2 = pdMap.get(p);
            if (!pd2) return isMinus ? comp((gene.seq[p-1]||'N').toUpperCase()) : (gene.seq[p-1]||'N').toUpperCase();
            const refBase = (gene.seq[p-1]||'N').toUpperCase();
            const allele = getAlleleForSample(pd2, sid, sampleList, isMinus ? comp(refBase) : refBase);
            const a = isMinus ? comp(allele) : allele;
            return a.includes('+') ? a[0] : (a === 'D' ? '-' : a);
          });
          const altCodon = bases.join('');
          if (altCodon === codon.refCodon) continue;
          if (altCodon.includes('-')) { frameshift++; continue; }
          const aa = GENETIC_CODE[altCodon.toUpperCase()] || '?';
          altAAs.add(aa);
          if (aa === codon.refAA) synonymous++;
          else nonsyn++;
        }
        return { cn: info.cn, refAA: codon.refAA, refCodon: codon.refCodon, altAAs: [...altAAs].join('/') || '-', synonymous, nonsyn, frameshift };
      });

      const rowAApos  = showProtein ? ['', 'AA position', ''] : null;
      const rowRefAA  = showProtein ? ['', 'Ref AA', '']      : null;
      const rowAltAA  = showProtein ? ['', 'Alt AA', '']      : null;
      const rowSyn    = showProtein ? ['', 'Synonymous', '']  : null;
      const rowNonSyn = showProtein ? ['', 'Non-syn', '']     : null;
      const rowFs     = showProtein ? ['', 'Frameshift', '']  : null;

      // filterNonSyn: include only CDS columns that contain non-syn variants
      const includedIdx = new Set(
        filterNonSyn
          ? colCache.map((_, i) => i).filter(i => colProtein[i]?.nonsyn > 0)
          : colCache.map((_, i) => i)
      );

      colCache.forEach((col, idx) => {
        if (!includedIdx.has(idx)) return;
        if (col.type === 'ref') {
          const region = classifyPosition(col.pos, gene);
          row1.push(REGION_LBL[region] || region || '');
          row2.push(posMode === 'rapdb' ? localToRapdb(col.pos, offset) : col.pos);
          row3.push(col.refBase);
          // most frequent alt allele
          const altCnts = altAlleleCounts[idx];
          const topAlt = Object.keys(altCnts).length
            ? Object.entries(altCnts).sort((a,b)=>b[1]-a[1])[0][0]
            : '-';
          row3b.push(topAlt);
          row4.push(altSampleCounts[idx]);
          if (showProtein) {
            const p = colProtein[idx];
            rowAApos.push(p ? p.cn : '');
            rowRefAA.push(p ? p.refAA : '');
            rowAltAA.push(p ? p.altAAs : '');
            rowSyn.push(p ? p.synonymous : '');
            rowNonSyn.push(p ? p.nonsyn : '');
            rowFs.push(p ? p.frameshift : '');
          }
        } else {
          const pl = posMode === 'rapdb' ? localToRapdb(col.afterPos, offset) : col.afterPos;
          row1.push('Insertion');
          row2.push(`${pl}+${col.insIdx + 1}`);
          row3.push('-');
          row3b.push('-');
          row4.push(altSampleCounts[idx]);
          if (showProtein) {
            rowAApos.push(''); rowRefAA.push(''); rowAltAA.push('');
            rowSyn.push(''); rowNonSyn.push(''); rowFs.push('');
          }
        }
      });

      // 5. Final CSV
      const filteredSampleLines = sampleLines.map(({ rowData, rowCols }) => {
        const vals = rowCols.filter(c => includedIdx.has(c.idx)).map(c => c.val);
        return [...rowData, ...vals].map(esc).join(',');
      });

      const lines = [
        row1.map(esc).join(','),
        row2.map(esc).join(','),
        row3.map(esc).join(','),
        row3b.map(esc).join(','),
        row4.map(esc).join(','),
        ...(showProtein ? [
          rowAApos.map(esc).join(','),
          rowRefAA.map(esc).join(','),
          rowAltAA.map(esc).join(','),
          rowSyn.map(esc).join(','),
          rowNonSyn.map(esc).join(','),
          rowFs.map(esc).join(','),
        ] : []),
        ...filteredSampleLines,
      ];

      setProgress(97); setStatus('Creating file...'); await tick();

      const blob = new Blob(['\uFEFF' + lines.join('\n')],
        { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url;
      a.download = `${gene.id}_${gene.sym}_haplotype${filterNonSyn ? '_nonsyn' : ''}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setProgress(100);
      setStatus(`Done! ${totalSamples} samples × ${cols.length} columns`);
      setTimeout(onClose, 1200);

    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
      setRunning(false);
    }
  }, [gene, hapData, positionData, shownSamples, posMode,
      sampleList, msaColumns, sampleInsMap, running]);

  const nSamples = shownSamples?.length || 0;
  const nCols    = (msaColumns || []).length;
  const flagLabel = viewFlags
    ? [viewFlags.identical && 'Identical', viewFlags.snp && 'SNP',
       viewFlags.indel && 'InDel', viewFlags.gap && 'Gap']
        .filter(Boolean).join(' + ')
    : '';

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)',
      zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={running ? undefined : onClose}>
      <div style={{ background:'var(--bg1)', borderRadius:10, padding:'24px 28px',
        minWidth:460, maxWidth:640, boxShadow:'0 8px 32px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ fontWeight:700, fontSize:15, marginBottom:6, color:'var(--t0)' }}>⬇ Export</div>
        <div style={{ fontSize:12, color:'var(--t2)', marginBottom:16, lineHeight:1.6 }}>
          Export based on current view settings.<br/>
          <b>{nSamples}</b> samples × <b>{nCols}</b> columns
          {flagLabel && <span style={{ color:'var(--t3)', marginLeft:4 }}>({flagLabel})</span>}
        </div>

        {running && (
          <div style={{ marginBottom:14 }}>
            <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
              <div style={{
                height:'100%', borderRadius:3,
                background: progress === 100 ? '#16a34a' : 'var(--accent)',
                width:`${progress}%`, transition:'width 0.3s ease',
              }} />
            </div>
            <div style={{ marginTop:5, fontSize:11, color:'var(--t2)' }}>{status}</div>
          </div>
        )}

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          {!running && (
            <button onClick={onClose}
              style={{ padding:'6px 14px', borderRadius:6, cursor:'pointer',
                border:'1px solid var(--border)', background:'var(--bg2)',
                color:'var(--t1)', fontSize:12 }}>
              Cancel
            </button>
          )}
          <button onClick={() => handleExport(false)} disabled={running}
            style={{ padding:'6px 14px', borderRadius:6, border:'none',
              background: running ? 'var(--bg3)' : 'var(--accent)',
              color: running ? 'var(--t2)' : '#fff',
              cursor: running ? 'default' : 'pointer', fontSize:12, fontWeight:600 }}>
            {running ? `${progress}%` : '⬇ Download CSV'}
          </button>
          {showProtein && !running && (
            <button onClick={() => handleExport(true)}
              style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #ef4444',
                background:'#fef2f2', color:'#ef4444',
                cursor:'pointer', fontSize:12, fontWeight:600 }}>
              ⬇ Non-syn only
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
