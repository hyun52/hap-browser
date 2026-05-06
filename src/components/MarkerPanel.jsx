import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { designKASP, designInDel, FAM_TAIL, HEX_TAIL } from '../utils/markerDesign.js';
import { localToRapdb } from '../utils/positionUtils.js';
import { getAlleleForSample } from '../utils/haplotype.js';

export default function MarkerPanel({ gene, positionData, hapData, sampleList: precomputedSampleList, sampleMeta = null, dragRange, onClose }) {

  // ── Options ──
  // ── KASP Options ──
  const [minAmplicon, setMinAmplicon] = useState(50);
  const [maxAmplicon, setMaxAmplicon] = useState(150);
  const [aspMinLen, setAspMinLen] = useState(21);
  const [aspMaxLen, setAspMaxLen] = useState(25);
  const [cpMinLen, setCpMinLen]   = useState(20);
  const [cpMaxLen, setCpMaxLen]   = useState(30);
  const [tmMin, setTmMin] = useState(62);
  const [tmMax, setTmMax] = useState(65);
  const [gcMin, setGcMin] = useState(40);
  const [gcMax, setGcMax] = useState(60);
  const [aspTmDiffMax, setAspTmDiffMax] = useState(0.5);
  const [aspCpTmDiffMax, setAspCpTmDiffMax] = useState(3.0);
  const [kaspHairpinStem, setKaspHairpinStem] = useState(4);
  const [kaspDimerOverlap, setKaspDimerOverlap] = useState(4); // max ASP/CP Tm diff
  const [autoAdjust, setAutoAdjust] = useState(false);
  const [maskNeighbors, setMaskNeighbors] = useState(false); // Avoid neighboring variants in primer regions

  // ── InDel Options ──
  const [indelMinAmp, setIndelMinAmp] = useState(100);
  const [indelMaxAmp, setIndelMaxAmp] = useState(300);
  const [indelPrimerMin, setIndelPrimerMin] = useState(18);
  const [indelPrimerMax, setIndelPrimerMax] = useState(25);
  const [indelTmMin, setIndelTmMin] = useState(55);
  const [indelTmMax, setIndelTmMax] = useState(65);
  const [indelGcMin, setIndelGcMin] = useState(40);
  const [indelGcMax, setIndelGcMax] = useState(60);
  const [indelTmDiffMax, setIndelTmDiffMax] = useState(2.0);
  const [indelHairpinStem, setIndelHairpinStem] = useState(4);
  const [indelDimerOverlap, setIndelDimerOverlap] = useState(4);

  const [showOpts, setShowOpts] = useState(false);

  // ── State ──
  const [selectedSnpPos, setSelectedSnpPos] = useState(null);
  const [selectedIndelPos, setSelectedIndelPos] = useState(null);
  const [result, setResult] = useState(null);

  // ── Primer3 validation state ───────────────────────────────────────
  // On successful design, automatically call backend /api/primer3/validate to
  // recompute Tm / hairpin / dimer using Primer3.
  // If server is off or primer3-py is unavailable, skip silently (UI shows status).
  const [p3Status, setP3Status] = useState('idle');  // idle | loading | ok | unavailable | error
  const [p3Result, setP3Result] = useState(null);    // server response
  const [tab, setTab] = useState('kasp');

  const offset   = gene?.offset ?? 0;
  const refSeq   = gene?.seq ?? '';
  const allHaps  = hapData?.haplotypes ?? [];

  // Variant positions within the drag range
  const rangeVariants = useMemo(() => {
    if (!positionData || !dragRange) return [];
    return positionData.filter(pd =>
      pd.pos >= dragRange.startPos && pd.pos <= dragRange.endPos &&
      (pd.hasSnp || pd.hasDel || pd.hasIns || pd.hasNoCov)
    );
  }, [positionData, dragRange]);

  const snpPositions   = rangeVariants.filter(pd => pd.hasSnp);
  const indelPositions = rangeVariants.filter(pd => pd.hasDel || pd.hasIns || pd.hasNoCov);

  // Per-haplotype allele at selected SNP + automatic allele1/2 assignment
  const snpInfo = useMemo(() => {
    if (!selectedSnpPos || !positionData) return null;
    const pd = positionData.find(p => p.pos === selectedSnpPos);
    if (!pd) return null;
    const allSamples = precomputedSampleList?.length ? precomputedSampleList : allHaps.flatMap(h => h.samples);
    const hapAlleles = {};
    for (const hap of allHaps) {
      const counts = {};
      for (const sid of hap.samples) {
        const a = getAlleleForSample(pd, sid, allSamples, pd.ref);
        counts[a] = (counts[a] || 0) + 1;
      }
      hapAlleles[hap.id] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? pd.ref;
    }
    // Count alleles overall
    const alleleCounts = {};
    for (const a of Object.values(hapAlleles)) {
      alleleCounts[a] = (alleleCounts[a] || 0) + 1;
    }
    const sorted = Object.entries(alleleCounts).sort((a, b) => b[1] - a[1]);
    // allele1 = more frequent allele (fallback to ref), allele2 = runner-up
    const allele1 = sorted[0]?.[0] ?? pd.ref;
    const allele2 = sorted[1]?.[0] ?? '';
    // Indicate whether ref
    const allele1IsRef = allele1 === pd.ref;
    return { pd, hapAlleles, allele1, allele2, allele1IsRef };
  }, [selectedSnpPos, positionData, allHaps, precomputedSampleList]);

  // needsPage: whether there is a small InDel in the drag range
  const needsPage = useMemo(() =>
    indelPositions.some(pd => pd.hasIns && pd.alt?.[0]?.includes('+') && (pd.alt[0].split('+')[1]?.length || 1) < 10)
  , [indelPositions]);

  // Classify samples by allele
  const sampleGroups = useMemo(() => {
    if (!snpInfo || !result || result.error) return null;
    const { allele1, allele2, hapAlleles } = snpInfo;
    const groups = { allele1: [], allele2: [], other: [] };
    for (const hap of allHaps) {
      const a = hapAlleles[hap.id];
      const key = a === allele1 ? 'allele1' : a === allele2 ? 'allele2' : 'other';
      groups[key].push({ hap, allele: a });
    }
    return groups;
  }, [snpInfo, result, allHaps]);

  const runDesign = useCallback(() => {
    if (!gene || !refSeq) return;
    // Reset previous Primer3 result when a new design starts
    setP3Status('idle'); setP3Result(null);
    if (tab === 'kasp') {
      if (!selectedSnpPos || !snpInfo) {
        setResult({ error: 'Select a SNP position.' }); return;
      }
      if (!snpInfo.allele2) {
        setResult({ error: 'No haplotype with Alt allele found at this position.' }); return;
      }
      const r = designKASP(
        refSeq, selectedSnpPos,
        snpInfo.allele1, snpInfo.allele2,
        gene.strand, positionData,
        { minAmplicon, maxAmplicon, aspMinLen, aspMaxLen, cpMinLen, cpMaxLen, tmMin, tmMax, gcMin, gcMax, aspTmDiffMax, aspCpTmDiffMax, hairpinMinStem: kaspHairpinStem, dimerMinOverlap: kaspDimerOverlap, autoAdjust, maskNeighbors, sampleList: precomputedSampleList, sampleMeta }
      );
      setResult(r);
    } else {
      if (!dragRange) { setResult({ error: 'No range selected.' }); return; }
      const r = designInDel(refSeq, dragRange.startPos, dragRange.endPos, positionData,
        { primerMinLen: indelPrimerMin, primerMaxLen: indelPrimerMax,
          tmMin: indelTmMin, tmMax: indelTmMax, gcMin: indelGcMin, gcMax: indelGcMax,
          minAmplicon: indelMinAmp, maxAmplicon: indelMaxAmp,
          tmDiffMax: indelTmDiffMax, hairpinMinStem: indelHairpinStem, dimerMinOverlap: indelDimerOverlap, autoAdjust });
      setResult(r);
    }
  }, [gene, refSeq, tab, selectedSnpPos, snpInfo, selectedIndelPos, indelPositions, positionData,
      minAmplicon, maxAmplicon, aspMinLen, aspMaxLen, cpMinLen, cpMaxLen, tmMin, tmMax, gcMin, gcMax, aspTmDiffMax, aspCpTmDiffMax, kaspHairpinStem, kaspDimerOverlap, autoAdjust, maskNeighbors,
      precomputedSampleList, sampleMeta,
      indelMinAmp, indelMaxAmp, indelPrimerMin, indelPrimerMax, indelTmMin, indelTmMax, indelGcMin, indelGcMax, indelTmDiffMax, indelHairpinStem, indelDimerOverlap]);

  // ── Primer3 validation effect ─────────────────────────────────────────
  // When result is successful (no error + primer present), automatically send to backend for validation
  useEffect(() => {
    if (!result || result.error) { setP3Status('idle'); setP3Result(null); return; }

    // KASP: primers.allele1 / allele2 / common
    // InDel: primers.forward / reverse
    let toCheck = [];
    if (result.type === 'KASP' && result.primers) {
      if (result.primers.allele1?.seq) toCheck.push({ label: 'ASP1', seq: result.primers.allele1.seq });
      if (result.primers.allele2?.seq) toCheck.push({ label: 'ASP2', seq: result.primers.allele2.seq });
      if (result.primers.common?.seq) toCheck.push({ label: 'CP', seq: result.primers.common.seq });
    } else if (result.type === 'InDel' && result.primers) {
      if (result.primers.forward?.seq) toCheck.push({ label: 'Forward', seq: result.primers.forward.seq });
      if (result.primers.reverse?.seq) toCheck.push({ label: 'Reverse', seq: result.primers.reverse.seq });
    }
    if (!toCheck.length) { setP3Status('idle'); return; }

    let cancelled = false;
    setP3Status('loading'); setP3Result(null);

    (async () => {
      try {
        const res = await fetch('/api/primer3/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primers: toCheck,
            mv_conc: 50, dv_conc: 1.5, dntp_conc: 0.2, dna_conc: 250, temp_c: 37,
          }),
        });
        if (cancelled) return;
        if (res.status === 503) {
          // primer3-py not installed server-side
          setP3Status('unavailable'); setP3Result(null);
          return;
        }
        if (!res.ok) { setP3Status('error'); setP3Result({ error: `HTTP ${res.status}` }); return; }
        const data = await res.json();
        if (cancelled) return;
        if (data.error) { setP3Status('error'); setP3Result({ error: data.error }); return; }
        setP3Status('ok'); setP3Result(data);
      } catch (e) {
        if (cancelled) return;
        // Network error — backend likely not running
        setP3Status('unavailable'); setP3Result({ error: e.message });
      }
    })();

    return () => { cancelled = true; };
  }, [result]);

  const exportText = useCallback(() => {
    if (!result || result.error) return;
    const lines = [
      `=== ${result.type} Marker Design ===`,
      `Gene: ${gene.sym} (${gene.id})`,
      `Position: ${localToRapdb(result.snpPos ?? result.indelPos, offset).toLocaleString()} (RAP-DB)`,
      `Amplicon: ${result.ampliconSize} bp`,
      '',
    ];
    if (result.type === 'KASP') {
      lines.push(`[ASP1 - FAM] Allele ${result.allele1}`);
      lines.push(`  5'-${FAM_TAIL}-[${result.primers.allele1.seq}]-3'`);
      lines.push(`  Tm: ${result.primers.allele1.tm}°C  GC: ${result.primers.allele1.gc}%  Len: ${result.primers.allele1.len}nt`);
      lines.push(`[ASP2 - HEX] Allele ${result.allele2}`);
      lines.push(`  5'-${HEX_TAIL}-[${result.primers.allele2.seq}]-3'`);
      lines.push(`  Tm: ${result.primers.allele2.tm}°C  GC: ${result.primers.allele2.gc}%  Len: ${result.primers.allele2.len}nt`);
      lines.push(`[CP] Common Primer`);
      lines.push(`  5'-${result.primers.common.seq}-3'`);
      lines.push(`  Tm: ${result.primers.common.tm}°C  GC: ${result.primers.common.gc}%  Len: ${result.primers.common.len}nt`);
      if (sampleGroups) {
        lines.push('', '--- Sample Groups ---');
        // FAM group
        const famTotal = sampleGroups.allele1.reduce((s,g)=>s+(g.hap.samples?.length??0),0);
        lines.push(`FAM (Allele ${result.allele1}): ${famTotal} samples`);
        for (const g of sampleGroups.allele1) {
          for (const sid of (g.hap.samples || [])) {
            lines.push(`${g.hap.label}\t${sid}`);
          }
        }
        // HEX group
        const hexTotal = sampleGroups.allele2.reduce((s,g)=>s+(g.hap.samples?.length??0),0);
        lines.push(`HEX (Allele ${result.allele2}): ${hexTotal} samples`);
        for (const g of sampleGroups.allele2) {
          for (const sid of (g.hap.samples || [])) {
            lines.push(`${g.hap.label}\t${sid}`);
          }
        }
        if (sampleGroups.other.length) {
          const otherTotal = sampleGroups.other.reduce((s,g)=>s+(g.hap.samples?.length??0),0);
          lines.push(`Other: ${otherTotal} samples`);
          for (const g of sampleGroups.other) {
            for (const sid of (g.hap.samples || [])) {
              lines.push(`${g.hap.label}\t${sid}`);
            }
          }
        }
      }
    } else {
      // InDel header
      lines[2] = `Range: ${localToRapdb(result.rangeStart, offset).toLocaleString()} – ${localToRapdb(result.rangeEnd, offset).toLocaleString()} (RAP-DB)`;
      lines[3] = `Ref Amplicon: ${result.ampliconSize}bp`;
      lines.push(`[Forward Primer]`);
      lines.push(`  5'-${result.primers.forward.seq}-3'`);
      lines.push(`  Tm: ${result.primers.forward.tm}°C  GC: ${result.primers.forward.gc}%  Len: ${result.primers.forward.len}nt`);
      lines.push(`[Reverse Primer]`);
      lines.push(`  5'-${result.primers.reverse.seq}-3'`);
      lines.push(`  Tm: ${result.primers.reverse.tm}°C  GC: ${result.primers.reverse.gc}%  Len: ${result.primers.reverse.len}nt`);
      if (result.needsPage) lines.push(`⚠ PAGE recommended (small InDel)`);
      if (result.primerSnps > 0) lines.push(`⚠ ${result.primerSnps} SNP(s) in primer binding region`);
      lines.push(`Note: ${result.note}`);

      // Band Pattern — recompute hapBands
      if (allHaps.length && positionData) {
        const allSamples = allHaps.flatMap(h => h.samples);
        const rangeIndels = positionData.filter(pd =>
          pd.pos >= result.rangeStart && pd.pos <= result.rangeEnd &&
          (pd.hasDel || pd.hasIns || pd.hasNoCov)
        );
        const hapBands = allHaps.map(hap => {
          let totalShift = 0;
          const details = [];
          for (const pd of rangeIndels) {
            const hasAlt = hap.samples.some(sid => {
              const si = allSamples.indexOf(sid);
              return si >= 0 && pd.enc?.[si] !== '0';
            });
            if (hasAlt) {
              const size = pd.hasIns && pd.alt?.[0]?.includes('+') ? pd.alt[0].split('+')[1]?.length || 1 : 1;
              totalShift += pd.hasIns ? size : -size;
              details.push(`${pd.hasIns?'INS':'DEL'}(${pd.hasIns?'+':'-'}${size}bp)@${localToRapdb(pd.pos, offset).toLocaleString()}`);
            }
          }
          return { hap, totalShift, details };
        });

        // Group by shift
        const bandGroups = {};
        for (const hb of hapBands) {
          const key = hb.totalShift;
          if (!bandGroups[key]) bandGroups[key] = { shift: key, haps: [], details: hb.details };
          bandGroups[key].haps.push(hb.hap);
        }

        lines.push('', '--- Band Pattern ---');
        // Ref band first
        const refGroup = bandGroups[0];
        if (refGroup) {
          const total = refGroup.haps.reduce((s,h)=>s+(h.samples?.length??0),0);
          lines.push(`Ref band (${result.ampliconSize}bp): ${total} samples`);
          for (const hap of refGroup.haps) {
            for (const sid of (hap.samples || [])) lines.push(`${hap.label}\t${sid}`);
          }
        }
        // Alt bands — by shift magnitude
        for (const [shift, group] of Object.entries(bandGroups).sort((a,b)=>Number(b[0])-Number(a[0]))) {
          if (Number(shift) === 0) continue;
          const bandSize = result.ampliconSize + Number(shift);
          const total = group.haps.reduce((s,h)=>s+(h.samples?.length??0),0);
          const shiftStr = Number(shift) > 0 ? `+${shift}bp` : `${shift}bp`;
          lines.push(`Alt band (${bandSize}bp, ${shiftStr}): ${total} samples  [${group.details.join(', ')}]`);
          for (const hap of group.haps) {
            for (const sid of (hap.samples || [])) lines.push(`${hap.label}\t${sid}`);
          }
        }
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${gene.id}_${result.type}_marker.txt`;
    a.click();
  }, [result, gene, offset, sampleGroups, positionData, allHaps]);

  if (!dragRange) return null;

  const N = (label, val, set, min, max, step=1) => (
    <label className="mp-opt-label">
      {label}
      <input type="number" className="mp-opt-input" value={val} min={min} max={max} step={step}
        onChange={e => { set(Number(e.target.value)); setResult(null); }} />
    </label>
  );

  return (
    <div className="mp-overlay">
      <div className="mp-modal-wrapper">
        <div className="mp-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="mp-hd">
          <span>🧬 Marker Design</span>
          <span className="mp-range-badge">
            {localToRapdb(dragRange.startPos, offset).toLocaleString()} – {localToRapdb(dragRange.endPos, offset).toLocaleString()}
          </span>
        </div>

        {/* Tabs */}
        <div className="mp-tabs">
          <button className={`mp-tab ${tab==='kasp'?'active':''}`} onClick={()=>{setTab('kasp');setResult(null);}}>KASP (SNP)</button>
          <button className={`mp-tab ${tab==='indel'?'active':''}`} onClick={()=>{setTab('indel');setResult(null);}}>InDel Marker</button>
        </div>

        <div className="mp-body">
          {tab === 'kasp' && (
            <>
              {/* SNP position selection */}
              <div className="mp-section">
                <div className="mp-label">SNP Position ({snpPositions.length})</div>
                {snpPositions.length === 0
                  ? <div className="mp-empty">No SNP in selected range.</div>
                  : <div className="mp-snp-list">
                      {snpPositions.map(pd => {
                        const altAllele = pd.alt?.[0] || '?';
                        const nAlt = pd.enc ? (pd.enc.match(/[^0]/g)||[]).length : 0;
                        return (
                          <button key={pd.pos}
                            className={`mp-snp-btn ${selectedSnpPos===pd.pos?'active':''}`}
                            onClick={() => { setSelectedSnpPos(pd.pos); setResult(null); }}>
                            {localToRapdb(pd.pos, offset).toLocaleString()}
                            <span className="mp-snp-ref"> {pd.ref}→{altAllele}</span>
                            <span className="mp-snp-n"> n={nAlt}</span>
                          </button>
                        );
                      })}
                    </div>
                }
              </div>

              {/* Auto-assigned allele display */}
              {snpInfo && (
                <div className="mp-section">
                  <div className="mp-allele-row">
                    <span className="mp-allele-badge fam">FAM — Allele 1: <b>{snpInfo.allele1}</b> ({snpInfo.allele1IsRef ? 'Ref' : 'Alt'})</span>
                    <span className="mp-allele-badge hex">HEX — Allele 2: <b>{snpInfo.allele2 || '—'}</b> ({snpInfo.allele1IsRef ? 'Alt' : 'Ref'})</span>
                  </div>
                  {/* Per-haplotype allele display */}
                  <div className="mp-hap-allele-list">
                    {allHaps.map(hap => {
                      const a = snpInfo.hapAlleles[hap.id];
                      const isFam = a === snpInfo.allele1;
                      const isHex = a === snpInfo.allele2;
                      return (
                        <div key={hap.id} className="mp-hap-allele-row">
                          <span className="mp-hap-label">{hap.label}</span>
                          <span className={`mp-hap-badge ${isFam?'fam':isHex?'hex':'other'}`}>{a}</span>
                          <span className="mp-hap-n">n={hap.nSamples ?? hap.samples?.length ?? 0}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'indel' && (
            <>
              {/* Drag range info */}
              <div className="mp-section">
                <div className="mp-label">Target Range</div>
                <div style={{fontSize:12, padding:'6px 10px', background:'var(--bg2)', borderRadius:5, border:'1px solid var(--border)'}}>
                  <span style={{fontFamily:'var(--mono)', fontWeight:700, color:'var(--accent)'}}>
                    {localToRapdb(dragRange.startPos, offset).toLocaleString()} – {localToRapdb(dragRange.endPos, offset).toLocaleString()}
                  </span>
                  <span style={{color:'var(--t2)', marginLeft:8}}>
                    ({dragRange.endPos - dragRange.startPos + 1}bp)
                  </span>
                </div>
                {/* Variant summary within range */}
                {indelPositions.length > 0 && (
                  <div style={{fontSize:11, color:'var(--t1)', marginTop:4}}>
                    {[
                      indelPositions.filter(p=>p.hasIns).length > 0 && `INS ×${indelPositions.filter(p=>p.hasIns).length}`,
                      indelPositions.filter(p=>p.hasDel).length > 0 && `DEL ×${indelPositions.filter(p=>p.hasDel).length}`,
                      indelPositions.filter(p=>p.hasNoCov).length > 0 && `GAP ×${indelPositions.filter(p=>p.hasNoCov).length}`,
                    ].filter(Boolean).join('  ')}
                  </div>
                )}
                {indelPositions.length === 0 && (
                  <div className="mp-empty">No InDel/Gap in selected range — primers will still be designed flanking the range.</div>
                )}
              </div>

              {/* Band Pattern — per-sample InDel analysis within drag range */}
              {indelPositions.length > 0 && (() => {
                // Analyze which variants each haplotype has within the drag range
                const allSamples = allHaps.flatMap(h => h.samples);
                const hapBands = allHaps.map(hap => {
                  let totalShift = 0;
                  const variantDetails = [];
                  for (const pd of indelPositions) {
                    // Check if these samples differ from ref via enc
                    const hasAlt = hap.samples.some(sid => {
                      const si = allSamples.indexOf(sid);
                      return si >= 0 && pd.enc?.[si] !== '0';
                    });
                    if (hasAlt) {
                      const type = pd.hasIns ? 'INS' : pd.hasDel ? 'DEL' : 'GAP';
                      const size = pd.hasIns && pd.alt?.[0]?.includes('+')
                        ? pd.alt[0].split('+')[1]?.length || 1 : 1;
                      totalShift += pd.hasIns ? size : -size;
                      variantDetails.push(`${type}(${pd.hasIns ? '+' : '-'}${size}bp)@${localToRapdb(pd.pos, offset).toLocaleString()}`);
                    }
                  }
                  return { hap, totalShift, variantDetails };
                });

                // Group into Ref band (no variant) vs Alt bands (with variants)
                const refBand = hapBands.filter(h => h.totalShift === 0);
                const altBands = hapBands.filter(h => h.totalShift !== 0);
                // Group by shift magnitude
                const shiftGroups = {};
                for (const h of altBands) {
                  const key = h.totalShift;
                  if (!shiftGroups[key]) shiftGroups[key] = [];
                  shiftGroups[key].push(h);
                }

                return (
                  <div className="mp-section">
                    <div className="mp-label">Expected Band Pattern</div>
                    <div style={{border:'1px solid var(--border)',borderRadius:6,overflow:'hidden'}}>
                      {/* Ref band */}
                      <div style={{padding:'8px 10px', background:'#f0fdf4', borderBottom:'1px solid var(--border)'}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#16a34a',marginBottom:4}}>
                          Ref band — {refBand.reduce((s,h)=>s+(h.hap.nSamples??h.hap.samples?.length??0),0)} samples
                          <span style={{fontWeight:400,color:'var(--t2)',marginLeft:8}}>(no variant in range)</span>
                        </div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                          {refBand.map(h => (
                            <span key={h.hap.id} className="mp-group-hap" style={{fontSize:10}}>
                              {h.hap.label} <span className="mp-hap-n">n={h.hap.nSamples??h.hap.samples?.length??0}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {/* Alt bands */}
                      {Object.entries(shiftGroups).sort((a,b)=>Number(b[0])-Number(a[0])).map(([shift, haps]) => (
                        <div key={shift} style={{padding:'8px 10px', background:'#fef3c7', borderBottom:'1px solid var(--border)'}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#d97706',marginBottom:4}}>
                            Alt band ({Number(shift) > 0 ? '+' : ''}{shift}bp) — {haps.reduce((s,h)=>s+(h.hap.nSamples??h.hap.samples?.length??0),0)} samples
                            <span style={{fontWeight:400,color:'var(--t2)',marginLeft:8,fontSize:10}}>
                              {haps[0]?.variantDetails.join(', ')}
                            </span>
                          </div>
                          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                            {haps.map(h => (
                              <span key={h.hap.id} className="mp-group-hap" style={{fontSize:10}}>
                                {h.hap.label} <span className="mp-hap-n">n={h.hap.nSamples??h.hap.samples?.length??0}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {altBands.length === 0 && (
                        <div style={{padding:'8px 10px',fontSize:11,color:'var(--t2)'}}>
                          No samples with InDel/Gap in this range
                        </div>
                      )}
                    </div>
                    {needsPage && (
                      <div style={{fontSize:11,color:'#d97706',marginTop:4}}>⚠ Small InDel detected — PAGE electrophoresis recommended</div>
                    )}
                  </div>
                );
              })()}
            </>
          )}

          {/* Options toggle */}
          <div className="mp-section">
            <button className="mp-opts-toggle" onClick={() => setShowOpts(v => !v)}>
              ⚙ Design Options {showOpts ? '▲' : '▼'}
            </button>
            {showOpts && (
              <div className="mp-opts-grid">
                {tab === 'kasp' ? (
                  <>
                    <div className="mp-opts-group" style={{flexBasis:'100%'}}>
                      <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer'}}>
                        <input type="checkbox" checked={autoAdjust}
                          onChange={e => { setAutoAdjust(e.target.checked); setResult(null); }} />
                        <span style={{fontWeight:600}}>Auto-adjust params</span>
                        <span style={{color:'var(--t2)',fontSize:11}}>— automatically expand Tm/GC range if no primer found</span>
                      </label>
                    </div>
                    <div className="mp-opts-group" style={{flexBasis:'100%'}}>
                      <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer'}}>
                        <input type="checkbox" checked={maskNeighbors}
                          onChange={e => { setMaskNeighbors(e.target.checked); setResult(null); }} />
                        <span style={{fontWeight:600}}>Avoid neighboring variants</span>
                        <span style={{color:'var(--t2)',fontSize:11}}>— mask other SNP/InDel sites; primers cannot bind across variants. Stricter, fewer candidates.</span>
                      </label>
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Amplicon (bp)</div>
                      {N('Min', minAmplicon, setMinAmplicon, 30, 500, 10)}
                      {N('Max', maxAmplicon, setMaxAmplicon, 50, 1000, 10)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">ASP Length (bp)</div>
                      {N('Min', aspMinLen, setAspMinLen, 18, 30)}
                      {N('Max', aspMaxLen, setAspMaxLen, 20, 35)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">CP Length (bp)</div>
                      {N('Min', cpMinLen, setCpMinLen, 18, 35)}
                      {N('Max', cpMaxLen, setCpMaxLen, 20, 40)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Tm (°C)</div>
                      {N('Min', tmMin, setTmMin, 50, 75)}
                      {N('Max', tmMax, setTmMax, 50, 80)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">GC (%)</div>
                      {N('Min', gcMin, setGcMin, 20, 60)}
                      {N('Max', gcMax, setGcMax, 40, 80)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">ASP Tm Diff max (°C)</div>
                      {N('Max', aspTmDiffMax, setAspTmDiffMax, 0.1, 3, 0.1)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">ASP/CP Tm Diff max (°C)</div>
                      {N('Max', aspCpTmDiffMax, setAspCpTmDiffMax, 0.5, 8, 0.5)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Hairpin min stem (bp)</div>
                      {N('Min', kaspHairpinStem, setKaspHairpinStem, 3, 8, 1)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Dimer min overlap (bp)</div>
                      {N('Min', kaspDimerOverlap, setKaspDimerOverlap, 3, 8, 1)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mp-opts-group" style={{flexBasis:'100%'}}>
                      <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer'}}>
                        <input type="checkbox" checked={autoAdjust}
                          onChange={e => { setAutoAdjust(e.target.checked); setResult(null); }} />
                        <span style={{fontWeight:600}}>Auto-adjust params</span>
                        <span style={{color:'var(--t2)',fontSize:11}}>— expand Tm/GC range automatically if no primer found</span>
                      </label>
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Amplicon (bp)</div>
                      {N('Min', indelMinAmp, setIndelMinAmp, 50, 500, 10)}
                      {N('Max', indelMaxAmp, setIndelMaxAmp, 100, 1000, 10)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Primer Length (nt)</div>
                      {N('Min', indelPrimerMin, setIndelPrimerMin, 15, 25)}
                      {N('Max', indelPrimerMax, setIndelPrimerMax, 18, 30)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Tm (°C)</div>
                      {N('Min', indelTmMin, setIndelTmMin, 45, 65)}
                      {N('Max', indelTmMax, setIndelTmMax, 55, 75)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">GC (%)</div>
                      {N('Min', indelGcMin, setIndelGcMin, 20, 60)}
                      {N('Max', indelGcMax, setIndelGcMax, 40, 80)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">F/R Tm Diff max (°C)</div>
                      {N('Max', indelTmDiffMax, setIndelTmDiffMax, 0.5, 5, 0.5)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Hairpin min stem (bp)</div>
                      {N('Min', indelHairpinStem, setIndelHairpinStem, 3, 8, 1)}
                    </div>
                    <div className="mp-opts-group">
                      <div className="mp-opts-group-title">Dimer min overlap (bp)</div>
                      {N('Min', indelDimerOverlap, setIndelDimerOverlap, 3, 8, 1)}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Run button */}
          <button className="mp-run-btn" onClick={runDesign}>🔬 Design Marker</button>

          {/* Result */}
          {result && (
            <div className="mp-result">
              {result.error ? (
                <div className="mp-result-error">
                  {result.error.split('\n').map((line, i) => (
                    <div key={i} style={{
                      fontWeight: i === 0 ? 700 : 400,
                      marginTop: i > 0 ? 3 : 0,
                      color: line.startsWith('Suggestion') ? '#0d9488' : line.startsWith('Reasons') ? '#b91c1c' : undefined,
                    }}>
                      {i === 0 ? '⚠ ' : ''}{line}
                    </div>
                  ))}
                  {result.blockingVariants && result.blockingVariants.length > 0 && (
                    <BlockingVariantsList
                      variants={result.blockingVariants}
                      offset={offset}
                      aspRegionInfo={result.aspRegionInfo}
                    />
                  )}
                </div>
              ) : (
                <>
                  <div className="mp-result-hd">
                    <span>{result.type} — {result.ampliconSize}bp amplicon</span>
                    <button className="mp-export-btn" onClick={exportText}>⬇ Export</button>
                  </div>

                  {/* Primer table */}
                  {result.type === 'KASP' ? (
                    <table className="mp-primer-table">
                      <thead>
                        <tr><th>Primer</th><th>Sequence (5'→3')</th><th>Tm</th><th>GC%</th><th>Len</th></tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td><span className="mp-tail-badge fam">FAM</span> ASP1 ({result.allele1})</td>
                          <td className="mp-primer-seq">
                            <span className="mp-tail-seq">{FAM_TAIL}</span>
                            <span className="mp-asp-seq">{result.primers.allele1.seq}</span>
                          </td>
                          <td>{result.primers.allele1.tm}°C</td>
                          <td>{result.primers.allele1.gc}%</td>
                          <td>{result.primers.allele1.len}nt</td>
                        </tr>
                        <tr>
                          <td><span className="mp-tail-badge hex">HEX</span> ASP2 ({result.allele2})</td>
                          <td className="mp-primer-seq">
                            <span className="mp-tail-seq">{HEX_TAIL}</span>
                            <span className="mp-asp-seq">{result.primers.allele2.seq}</span>
                          </td>
                          <td>{result.primers.allele2.tm}°C</td>
                          <td>{result.primers.allele2.gc}%</td>
                          <td>{result.primers.allele2.len}nt</td>
                        </tr>
                        <tr>
                          <td>CP (Common)</td>
                          <td className="mp-primer-seq">{result.primers.common.seq}</td>
                          <td>{result.primers.common.tm}°C</td>
                          <td>{result.primers.common.gc}%</td>
                          <td>{result.primers.common.len}nt</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <>
                      {/* PAGE warning */}
                      {result.needsPage && (
                        <div style={{padding:'6px 12px',background:'#fffbeb',borderTop:'1px solid #fde68a',fontSize:11,color:'#92400e',fontWeight:600}}>
                          ⚠ InDel size ~{result.indelSize}bp — PAGE electrophoresis recommended, keep amplicon ≤ 150bp
                        </div>
                      )}
                      {/* Neighboring-variant warning */}
                      {result.nearbyVariants > 0 && (
                        <div style={{padding:'6px 12px',background:'#fef2f2',borderTop:'1px solid #fecaca',fontSize:11,color:'#b91c1c'}}>
                          ⚠ {result.nearbyVariants} other variant(s) found within amplicon region — check primer specificity
                        </div>
                      )}
                      <table className="mp-primer-table">
                        <thead>
                          <tr><th>Primer</th><th>Sequence (5'→3')</th><th>Tm</th><th>GC%</th><th>Len</th></tr>
                        </thead>
                        <tbody>
                          {[['Forward', result.primers.forward], ['Reverse', result.primers.reverse]].map(([n,p]) => (
                            <tr key={n}><td>{n}</td><td className="mp-primer-seq">{p.seq}</td><td>{p.tm}°C</td><td>{p.gc}%</td><td>{p.len}nt</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {/* QC */}
                  {result.qc && (
                    <div className="mp-qc-row">
                      {result.type === 'KASP' ? (
                        <>
                          <QCBadge label="Hairpin" ok={!result.qc.hairpinA1 && !result.qc.hairpinA2 && !result.qc.hairpinCP} />
                          <QCBadge label="Self-dimer" ok={!result.qc.selfDimerA1 && !result.qc.selfDimerA2} />
                          <QCBadge label="Cross-dimer" ok={!result.qc.crossDimer} />
                          {result.qc.variantsMasked > 0 && (
                            <span className="mp-qc-mask" style={{color:'#d97706'}}>
                              ⚠ {result.qc.variantsMasked} SNP(s) in primer region
                            </span>
                          )}
                          {result.tmDiff !== undefined && (
                            <span className="mp-qc-mask">ASP Tm diff: {result.tmDiff.toFixed(1)}°C</span>
                          )}
                        </>
                      ) : (
                        <>
                          <QCBadge label="Hairpin" ok={!result.qc.hairpinFwd && !result.qc.hairpinRev} />
                          <QCBadge label="Self-dimer" ok={!result.qc.selfDimerFwd && !result.qc.selfDimerRev} />
                          <QCBadge label="Cross-dimer" ok={!result.qc.crossDimer} />
                          {result.tmDiff !== undefined && (
                            <span className="mp-qc-mask">Tm diff: {result.tmDiff.toFixed(1)}°C</span>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Params note — just below QC */}
                  {result.note && (() => {
                    const isAdjusted = result.note.includes('Auto-adjusted');
                    return (
                      <div className={`mp-param-note ${isAdjusted ? 'adjusted' : ''}`}>
                        {isAdjusted
                          ? <><span className="mp-param-badge">⚡ Auto-adjusted</span><span className="mp-param-text">Design params were automatically expanded to match local sequence characteristics.</span></>
                          : <span className="mp-param-text">Design params: {result.note.split('params: ')[1] || ''}</span>
                        }
                      </div>
                    );
                  })()}

                  {/* ── Primer3 validation ────────────────────────────── */}
                  <Primer3ValidationBox status={p3Status} data={p3Result} result={result} />

                  {/* Sample groups */}
                  {sampleGroups && (
                    <div className="mp-groups">
                      <div className="mp-groups-title">Expected Sample Groups</div>
                      <div className="mp-groups-row">
                        <div className="mp-group-box fam">
                          <div className="mp-group-hd">
                            <span className="mp-tail-badge fam">FAM</span> Allele {result.allele1}
                            <span className="mp-hap-n" style={{marginLeft:6}}>
                              ({sampleGroups.allele1.reduce((s,g)=>s+(g.hap.nSamples??g.hap.samples?.length??0),0)} samples)
                            </span>
                          </div>
                          <div style={{maxHeight:160, overflowY:'auto'}}>
                            {sampleGroups.allele1.map(g => (
                              <div key={g.hap.id}>
                                <div className="mp-group-hap" style={{fontWeight:600}}>
                                  {g.hap.label} <span className="mp-hap-n">n={g.hap.nSamples ?? g.hap.samples?.length ?? 0}</span>
                                </div>
                                {g.hap.samples?.map(sid => (
                                  <div key={sid} style={{fontSize:10, color:'var(--t2)', fontFamily:'var(--mono)', paddingLeft:8}}>{sid}</div>
                                ))}
                              </div>
                            ))}
                            {sampleGroups.allele1.length === 0 && <div className="mp-empty">None</div>}
                          </div>
                        </div>
                        <div className="mp-group-box hex">
                          <div className="mp-group-hd">
                            <span className="mp-tail-badge hex">HEX</span> Allele {result.allele2}
                            <span className="mp-hap-n" style={{marginLeft:6}}>
                              ({sampleGroups.allele2.reduce((s,g)=>s+(g.hap.nSamples??g.hap.samples?.length??0),0)} samples)
                            </span>
                          </div>
                          <div style={{maxHeight:160, overflowY:'auto'}}>
                            {sampleGroups.allele2.map(g => (
                              <div key={g.hap.id}>
                                <div className="mp-group-hap" style={{fontWeight:600}}>
                                  {g.hap.label} <span className="mp-hap-n">n={g.hap.nSamples ?? g.hap.samples?.length ?? 0}</span>
                                </div>
                                {g.hap.samples?.map(sid => (
                                  <div key={sid} style={{fontSize:10, color:'var(--t2)', fontFamily:'var(--mono)', paddingLeft:8}}>{sid}</div>
                                ))}
                              </div>
                            ))}
                            {sampleGroups.allele2.length === 0 && <div className="mp-empty">None</div>}
                          </div>
                        </div>
                        {sampleGroups.other.length > 0 && (
                          <div className="mp-group-box other">
                            <div className="mp-group-hd">Other</div>
                            <div style={{maxHeight:160, overflowY:'auto'}}>
                              {sampleGroups.other.map(g => (
                                <div key={g.hap.id}>
                                  <div className="mp-group-hap" style={{fontWeight:600}}>
                                    {g.hap.label} [{g.allele}]
                                  </div>
                                  {g.hap.samples?.map(sid => (
                                    <div key={sid} style={{fontSize:10, color:'var(--t2)', fontFamily:'var(--mono)', paddingLeft:8}}>{sid}</div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mp-note" style={{display:'none'}}></div>
                </>
              )}
            </div>
          )}
        </div>
        </div>
        <button className="mp-close-outer" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}

function QCBadge({ label, ok }) {
  return (
    <span className={`mp-qc-badge ${ok ? 'pass' : 'fail'}`}>
      {ok ? '✓' : '⚠'} {label}
    </span>
  );
}

// ─── Primer3 Validation Box ──────────────────────────────────────────────
// Displays results from backend /api/primer3/validate. If the server is down or primer3-py is missing,
// shows an "unavailable" message gracefully.
function Primer3ValidationBox({ status, data, result }) {
  if (status === 'idle') return null;

  const hdStyle = {
    fontSize: 11, fontWeight: 700, color: 'var(--teal)',
    textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4,
    display: 'flex', alignItems: 'center', gap: 6,
  };
  const boxStyle = {
    marginTop: 12, padding: '10px 12px',
    border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg2)', fontSize: 11,
  };

  if (status === 'loading') {
    return (
      <div style={boxStyle}>
        <div style={hdStyle}>
          <span>⚙ Primer3 validation</span>
          <span style={{ color: 'var(--t2)', fontWeight: 400 }}>running…</span>
        </div>
        <div style={{ color: 'var(--t2)', fontSize: 10 }}>
          Re-calculating Tm / hairpin / dimer with Primer3 thermodynamics…
        </div>
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div style={{ ...boxStyle, background: 'var(--bg1)', borderStyle: 'dashed' }}>
        <div style={hdStyle}>
          <span style={{ color: 'var(--t2)' }}>ⓘ Primer3 validation unavailable</span>
        </div>
        <div style={{ color: 'var(--t2)', fontSize: 10, lineHeight: 1.5 }}>
          Backend Primer3 service not reachable. Tm values shown above are from
          the built-in SantaLucia/Owczarzy calculation. To enable Primer3
          validation, ensure the backend is running and{' '}
          <code style={{ background: 'var(--bg3)', padding: '0 3px', borderRadius: 2 }}>
            primer3-py
          </code>{' '}
          is installed (<code>pip install -r backend/requirements.txt</code>).
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ ...boxStyle, background: '#fef2f2', borderColor: '#fecaca' }}>
        <div style={{ ...hdStyle, color: '#b91c1c' }}>
          <span>⚠ Primer3 validation failed</span>
        </div>
        <div style={{ color: '#b91c1c', fontSize: 10 }}>
          {data?.error || 'Unknown error.'}
        </div>
      </div>
    );
  }

  // status === 'ok'
  const { primers = [], heterodimers = [], conditions, primer3_version } = data || {};
  if (!primers.length) return null;

  // Compare against local computation — pull the primer's Tm from result
  const builtinTm = {};
  if (result.type === 'KASP') {
    if (result.primers?.allele1) builtinTm.ASP1 = result.primers.allele1.tm;
    if (result.primers?.allele2) builtinTm.ASP2 = result.primers.allele2.tm;
    if (result.primers?.common)  builtinTm.CP   = result.primers.common.tm;
  } else if (result.type === 'InDel') {
    if (result.primers?.forward) builtinTm.Forward = result.primers.forward.tm;
    if (result.primers?.reverse) builtinTm.Reverse = result.primers.reverse.tm;
  }

  // Warning evaluation — ΔG in kcal/mol, more negative = stronger structure.
  // Typical rule: hairpin ΔG > -3 kcal/mol is OK, -3 to -6 caution, < -6 risky.
  // dimer ΔG > -6 kcal/mol OK, -6 to -9 caution, < -9 risky. (similar to IDT OligoAnalyzer)
  const dgLevel = (dg, kind) => {
    if (dg == null || dg >= 0) return 'pass';
    const t = kind === 'hairpin' ? [-3, -6] : [-6, -9];
    if (dg > t[0]) return 'pass';
    if (dg > t[1]) return 'warn';
    return 'fail';
  };
  const dgColor = (lv) => lv === 'pass' ? '#16a34a' : lv === 'warn' ? '#d97706' : '#dc2626';

  return (
    <div style={{ ...boxStyle, borderColor: '#0d9488', borderWidth: 1 }}>
      <div style={hdStyle}>
        <span>✓ Primer3 validation</span>
        <span style={{ color: 'var(--t2)', fontWeight: 400, fontSize: 10 }}>
          Primer3 v{primer3_version} · [Na⁺]={conditions?.Na_mM}mM · [Mg²⁺]={conditions?.Mg_mM}mM · [dNTP]={conditions?.dNTP_mM}mM · [oligo]={conditions?.oligo_nM}nM
        </span>
      </div>

      {/* Per-primer results table */}
      <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse',
                      fontFamily: 'var(--mono)', marginTop: 4 }}>
        <thead>
          <tr style={{ color: 'var(--t2)', textAlign: 'left',
                       borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '3px 6px 3px 0' }}>Primer</th>
            <th style={{ padding: '3px 6px', textAlign: 'right' }}>Tm (P3)</th>
            <th style={{ padding: '3px 6px', textAlign: 'right' }}>Tm (built-in)</th>
            <th style={{ padding: '3px 6px', textAlign: 'right' }}>Δ</th>
            <th style={{ padding: '3px 6px' }}>Hairpin ΔG</th>
            <th style={{ padding: '3px 6px' }}>Self-dimer ΔG</th>
          </tr>
        </thead>
        <tbody>
          {primers.map((p, i) => {
            const biTm = builtinTm[p.label];
            const diff = (biTm != null && p.tm != null) ? (p.tm - biTm) : null;
            const diffAbs = diff != null ? Math.abs(diff) : 0;
            const diffColor = diffAbs < 1 ? 'var(--t2)' :
                              diffAbs < 3 ? '#d97706' : '#dc2626';
            const hpLv = dgLevel(p.hairpin?.dg, 'hairpin');
            const sdLv = dgLevel(p.homodimer?.dg, 'dimer');
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--bg3)' }}>
                <td style={{ padding: '3px 6px 3px 0', fontWeight: 600 }}>
                  {p.label}
                  <span style={{ color: 'var(--t2)', fontWeight: 400, marginLeft: 4 }}>
                    ({p.length}nt)
                  </span>
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', fontWeight: 600 }}>
                  {p.tm != null ? `${p.tm.toFixed(1)}°C` : '—'}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--t2)' }}>
                  {biTm != null ? `${biTm}°C` : '—'}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: diffColor }}>
                  {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}` : '—'}
                </td>
                <td style={{ padding: '3px 6px', color: dgColor(hpLv) }}>
                  {p.hairpin?.found
                    ? `${p.hairpin.dg.toFixed(1)} kcal/mol (Tm ${p.hairpin.tm.toFixed(0)}°C)`
                    : <span style={{ color: '#16a34a' }}>none</span>}
                </td>
                <td style={{ padding: '3px 6px', color: dgColor(sdLv) }}>
                  {p.homodimer?.found
                    ? `${p.homodimer.dg.toFixed(1)} kcal/mol`
                    : <span style={{ color: '#16a34a' }}>none</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Heterodimer results */}
      {heterodimers.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--t2)', fontWeight: 600, marginBottom: 3 }}>
            Cross-dimers
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {heterodimers.map((h, i) => {
              const lv = dgLevel(h.dg, 'dimer');
              const bg = lv === 'pass' ? '#f0fdf4' : lv === 'warn' ? '#fffbeb' : '#fef2f2';
              const bd = lv === 'pass' ? '#bbf7d0' : lv === 'warn' ? '#fde68a' : '#fecaca';
              return (
                <span key={i} style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: bg, border: `1px solid ${bd}`,
                  color: dgColor(lv), fontFamily: 'var(--mono)',
                }}>
                  {h.a}×{h.b}: {h.found ? `${h.dg.toFixed(1)} kcal/mol` : 'none'}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Brief interpretation guide */}
      <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--border)',
                    fontSize: 9, color: 'var(--t2)', lineHeight: 1.5 }}>
        ΔG reference: hairpin &gt; −3 OK, &lt; −6 risky. Dimer &gt; −6 OK, &lt; −9 risky.
        Δ (P3 − built-in): differences &lt; 1°C are expected; &gt; 3°C may indicate
        unusual sequence context.
      </div>
    </div>
  );
}

// ─── BlockingVariantsList: shows nearby variants that blocked primer candidates ───
// Displays each blocking variant with position, type, sample count, and an
// expandable list of variety names. Helps users decide whether to stick with
// the strict mode or try a different SNP.
function BlockingVariantsList({ variants, offset, aspRegionInfo }) {
  const [expandedIdx, setExpandedIdx] = React.useState(null);
  if (!variants || !variants.length) return null;

  return (
    <div style={{ marginTop: 10, padding: 10, background: '#fff', border: '1px solid #fecaca', borderRadius: 4 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: '#991b1b', marginBottom: 6 }}>
        Blocking variants in primer region:
      </div>

      {/* ASP region sequence visualization */}
      {aspRegionInfo && aspRegionInfo.refSeq && (
        <AspRegionVisualization
          aspRegionInfo={aspRegionInfo}
          variants={variants}
          offset={offset}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {variants.map((v, i) => {
          const rapdbPos = (offset || 0) + v.pos;
          const expanded = expandedIdx === i;
          return (
            <div key={i} style={{ fontSize: 12, fontFamily: 'monospace' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: '#374151' }}>
                  pos <b>{rapdbPos.toLocaleString()}</b>
                </span>
                <span style={{ color: '#6b7280' }}>(local {v.pos})</span>
                <span style={{
                  padding: '1px 6px',
                  borderRadius: 3,
                  fontSize: 11,
                  background: v.kind === 'SNP' ? '#dbeafe' : '#fef3c7',
                  color: v.kind === 'SNP' ? '#1e40af' : '#92400e',
                }}>
                  {v.kind} {v.altDesc}
                </span>
                <span style={{ color: '#374151' }}>
                  <b>{v.nSamples}</b> sample{v.nSamples !== 1 ? 's' : ''}
                  {v.nSamples === 1 && <span style={{ color: '#dc2626', marginLeft: 4 }}>(rare)</span>}
                </span>
                {v.varieties && v.varieties.length > 0 && (
                  <button
                    onClick={() => setExpandedIdx(expanded ? null : i)}
                    style={{
                      padding: '2px 8px',
                      fontSize: 11,
                      background: '#f3f4f6',
                      border: '1px solid #d1d5db',
                      borderRadius: 3,
                      cursor: 'pointer',
                      color: '#374151',
                    }}
                  >
                    {expanded ? 'hide' : 'show'} varieties
                  </button>
                )}
              </div>
              {expanded && v.varieties && (
                <div style={{
                  marginTop: 4,
                  marginLeft: 16,
                  padding: 6,
                  background: '#f9fafb',
                  borderRadius: 3,
                  color: '#4b5563',
                  fontSize: 11,
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                }}>
                  {v.varieties.join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, fontStyle: 'italic' }}>
        Tip: variants with n=1 may be sequencing artifacts.
        Disable "Avoid neighboring variants" if rare variants are acceptable.
      </div>
    </div>
  );
}

// ─── AspRegionVisualization ─────────────────────────────────────────────────
// Visual ASCII-style display of the ASP binding region with blocking variants
// highlighted. Shows ref sequence in monospace, with markers above for each
// blocking variant's position. Target SNP is shown in brackets at the 3' end.
function AspRegionVisualization({ aspRegionInfo, variants, offset }) {
  const { refSeq, startPos, snpPos } = aspRegionInfo;
  if (!refSeq) return null;

  const length = refSeq.length;
  if (length === 0) return null;

  // Map each position in the ASP region to a column index (0..length-1)
  // pos is 1-based local; column = pos - startPos
  const variantCols = variants
    .map(v => ({
      ...v,
      col: v.pos - startPos,
    }))
    .filter(v => v.col >= 0 && v.col < length);

  // Build per-column "marker" status: which positions have variants
  const colMarker = new Array(length).fill(null);
  variantCols.forEach(v => {
    colMarker[v.col] = v;
  });

  // Constants
  const CHAR_W = 9;       // monospace char width (approx)
  const ROW_H = 16;       // row height
  const PAD_TOP = 8;
  const totalW = length * CHAR_W;

  return (
    <div style={{
      marginBottom: 10,
      padding: 10,
      background: '#f9fafb',
      border: '1px solid #e5e7eb',
      borderRadius: 4,
      overflowX: 'auto',
    }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
        ASP binding region (5'→3'), {length} bp ending at target SNP:
      </div>

      <div style={{ position: 'relative', minWidth: totalW + 100, height: 90, fontFamily: 'monospace' }}>
        {/* Position markers (down arrows above ref sequence at variant positions) */}
        <div style={{ position: 'absolute', top: 0, left: 0, height: 16, fontSize: 12, lineHeight: '16px' }}>
          {variantCols.map((v, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: v.col * CHAR_W + CHAR_W / 2,
                transform: 'translateX(-50%)',
                color: v.kind === 'SNP' ? '#1e40af' : '#92400e',
                fontWeight: 700,
              }}
              title={`${v.kind} ${v.altDesc} (${v.nSamples} sample${v.nSamples !== 1 ? 's' : ''})`}
            >
              ▼
            </span>
          ))}
        </div>

        {/* Ref sequence — bases highlighted at variant positions */}
        <div style={{
          position: 'absolute',
          top: PAD_TOP + ROW_H,
          left: 0,
          fontSize: 13,
          letterSpacing: 0,
        }}>
          {refSeq.split('').map((base, i) => {
            const isVariant = colMarker[i] !== null;
            const isSnpEnd = (startPos + i) === snpPos;
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  width: CHAR_W,
                  textAlign: 'center',
                  background: isSnpEnd ? '#fef3c7' : isVariant
                    ? (colMarker[i].kind === 'SNP' ? '#dbeafe' : '#fed7aa')
                    : 'transparent',
                  color: isSnpEnd ? '#92400e' : isVariant
                    ? (colMarker[i].kind === 'SNP' ? '#1e40af' : '#9a3412')
                    : '#374151',
                  fontWeight: (isVariant || isSnpEnd) ? 700 : 400,
                }}
              >
                {base}
              </span>
            );
          })}
          {/* SNP marker at 3' end */}
          <span style={{
            marginLeft: 4,
            padding: '1px 5px',
            background: '#fbbf24',
            color: '#78350f',
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 3,
          }}>
            [SNP]
          </span>
        </div>

        {/* Position labels below — show variant local pos */}
        <div style={{
          position: 'absolute',
          top: PAD_TOP + ROW_H * 2 + 4,
          left: 0,
          fontSize: 10,
          color: '#6b7280',
        }}>
          {variantCols.map((v, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: v.col * CHAR_W + CHAR_W / 2,
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              }}
            >
              {v.pos}
            </span>
          ))}
        </div>

        {/* 5' / 3' labels */}
        <div style={{
          position: 'absolute',
          top: PAD_TOP + ROW_H,
          left: -10,
          fontSize: 10,
          color: '#9ca3af',
        }}>5'</div>
      </div>

      {/* Color legend */}
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span><span style={{ background: '#dbeafe', padding: '0 4px', borderRadius: 2 }}>blue</span> = SNP</span>
        <span><span style={{ background: '#fed7aa', padding: '0 4px', borderRadius: 2 }}>orange</span> = InDel</span>
        <span><span style={{ background: '#fef3c7', padding: '0 4px', borderRadius: 2 }}>yellow</span> = target SNP (3' end)</span>
      </div>
    </div>
  );
}
