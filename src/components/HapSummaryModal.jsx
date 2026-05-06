import React, { useMemo, useState } from 'react';
import { localToRapdb } from '../utils/positionUtils.js';
import { getAlleleForSample } from '../utils/haplotype.js';

/**
 * HapSummaryModal
 *
 * Props:
 *  gene          - current gene object
 *  hapData       - { haplotypes, variantPositions }
 *  positionData  - precomputed positionData
 *  shownSamples  - currently filtered sample list
 *  posMode       - 'rapdb' | 'local'
 *  onClose
 */
export default function HapSummaryModal({ gene, hapData, positionData, shownSamples, posMode = 'rapdb', onClose }) {
  const [expandedHap, setExpandedHap] = useState(null);

  const offset = gene?.offset ?? 0;

  // positionData map
  const pdMap = useMemo(() => {
    const m = new Map();
    (positionData || []).forEach(pd => m.set(pd.pos, pd));
    return m;
  }, [positionData]);

  const shownSet = useMemo(() => new Set(shownSamples || []), [shownSamples]);

  // Haplotypes containing only currently displayed samples
  const visibleHaps = useMemo(() => {
    if (!hapData) return [];
    return hapData.haplotypes.map(hap => ({
      ...hap,
      visibleSamples: hap.samples.filter(s => shownSet.has(s)),
    })).filter(h => h.visibleSamples.length > 0);
  }, [hapData, shownSet]);

  // Representative variants (among variantPositions, those distinguishing haplotypes)
  const variantPos = hapData?.variantPositions ?? [];

  // ── CSV export (summary table) ────────────────────────────────────────────
  const exportSummaryCSV = () => {
    if (!hapData || !gene) return;
    const headers = ['Hap_ID', 'n_samples', 'nSNP', 'nGap', 'nIns', 'nVariants', 'Samples'];
    const rows = visibleHaps.map(h =>
      [h.id, h.visibleSamples.length, h.nSnp, h.nGap, h.nIns ?? 0, h.nVariants,
        `"${h.visibleSamples.join(';')}"`].join(',')
    );
    download([headers.join(','), ...rows].join('\n'),
      `${gene.id}_haplotype_summary.csv`);
  };

  // ── CSV export (full view — sample × position matrix) ─────────────────────
  const exportViewCSV = () => {
    if (!hapData || !gene || !positionData) return;
    const positions = variantPos;
    const posLabels = positions.map(p =>
      posMode === 'rapdb'
        ? `${gene.chr}:${localToRapdb(p, offset)}`
        : `local:${p}`
    );
    const headers = ['Sample', 'Haplotype', ...posLabels];
    const sampleHapMap = {};
    hapData.haplotypes.forEach(h => h.samples.forEach(s => { sampleHapMap[s] = h.id; }));

    const rows = (shownSamples || []).map(sid => {
      const hapId = sampleHapMap[sid] ?? '';
      const alleles = positions.map(p => {
        const pd = pdMap.get(p);
        if (!pd) return 'N';
        return getAlleleForSample(pd, sid, null, pd.ref);
      });
      return [sid, hapId, ...alleles].join(',');
    });
    download([headers.join(','), ...rows].join('\n'),
      `${gene.id}_view_export.csv`);
  };

  function download(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  if (!hapData) return null;

  return (
    <div className="hsm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hsm-modal">
        <div className="hsm-hd">
          <span>📊 Haplotype Summary — {gene?.sym}</span>
          <div className="hsm-hd-btns">
            <button className="hsm-export-btn" onClick={exportSummaryCSV} title="Haplotype summary CSV">
              ⬇ Summary CSV
            </button>
            <button className="hsm-export-btn" onClick={exportViewCSV} title="Sample × position matrix CSV">
              ⬇ View CSV
            </button>
            <button className="hsm-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="hsm-body">
          {/* Summary statistics */}
          <div className="hsm-stats-row">
            <div className="hsm-stat"><b>{visibleHaps.length}</b> haplotypes</div>
            <div className="hsm-stat"><b>{shownSamples?.length ?? 0}</b> samples shown</div>
            <div className="hsm-stat"><b>{variantPos.length}</b> variant positions</div>
          </div>

          {/* Haplotype list */}
          <table className="hsm-table">
            <thead>
              <tr>
                <th>Haplotype</th>
                <th>Samples (n)</th>
                <th>SNP</th>
                <th>Gap/Del</th>
                <th>Ins</th>
                <th>Total variants</th>
                <th>Key variants</th>
              </tr>
            </thead>
            <tbody>
              {visibleHaps.map(hap => {
                const keyVars = variantPos.slice(0, 5).map(p => {
                  const pd = pdMap.get(p);
                  if (!pd) return null;
                  const repSid = hap.visibleSamples[0];
                  const a = getAlleleForSample(pd, repSid, null, pd.ref);
                  const rapPos = posMode === 'rapdb'
                    ? localToRapdb(p, offset).toLocaleString()
                    : String(p);
                  return a !== pd.ref ? `${rapPos}:${pd.ref}→${a}` : null;
                }).filter(Boolean);

                const isExp = expandedHap === hap.id;
                return (
                  <React.Fragment key={hap.id}>
                    <tr className="hsm-hap-row" onClick={() => setExpandedHap(isExp ? null : hap.id)}>
                      <td><span className="hsm-hap-id">{hap.id}</span></td>
                      <td>
                        <span className="hsm-n-badge">{hap.visibleSamples.length}</span>
                        <span className="hsm-expand-icon">{isExp ? '▾' : '▸'}</span>
                      </td>
                      <td>{hap.nSnp}</td>
                      <td>{hap.nGap}</td>
                      <td>{hap.nIns ?? 0}</td>
                      <td><b>{hap.nVariants}</b></td>
                      <td className="hsm-key-vars">{keyVars.join(' · ') || '—'}</td>
                    </tr>
                    {isExp && (
                      <tr className="hsm-samples-row">
                        <td colSpan={7}>
                          <div className="hsm-samples-wrap">
                            {hap.visibleSamples.map(s => (
                              <span key={s} className="hsm-sample-chip">{s}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Variant-position detail table */}
          {variantPos.length > 0 && (
            <>
              <div className="hsm-section-title">Variant Positions × Haplotypes</div>
              <div className="hsm-variant-scroll">
                <table className="hsm-variant-table">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Ref</th>
                      <th>Region</th>
                      {visibleHaps.map(h => <th key={h.id}>{h.id}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {variantPos.map(p => {
                      const pd = pdMap.get(p);
                      if (!pd) return null;
                      const rapPos = posMode === 'rapdb'
                        ? localToRapdb(p, offset).toLocaleString()
                        : String(p);
                      const region = pd.inCds ? 'CDS' : pd.inGene ? 'Intron' : 'Flank';
                      return (
                        <tr key={p}>
                          <td className="hsm-pos">{rapPos}</td>
                          <td className="hsm-ref-base">{pd.ref}</td>
                          <td className="hsm-region" data-region={region.toLowerCase()}>{region}</td>
                          {visibleHaps.map(h => {
                            const repSid = h.visibleSamples[0];
                            const a = getAlleleForSample(pd, repSid, null, pd.ref);
                            const isAlt = a !== pd.ref;
                            return (
                              <td key={h.id} className={`hsm-allele ${isAlt ? 'alt' : 'ref'}`}>
                                {a}
                                {pd.aaChange && isAlt && pd.aaChange.alts?.[a]
                                  ? <span className={`hsm-aa-badge ${pd.aaChange.alts[a].type}`}>
                                      {pd.aaChange.alts[a].type === 'synonymous' ? 'syn' :
                                       pd.aaChange.alts[a].type === 'nonsynonymous' ? 'ns' :
                                       pd.aaChange.alts[a].type === 'stop_gained' ? 'stop' : 'fs'}
                                    </span>
                                  : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
