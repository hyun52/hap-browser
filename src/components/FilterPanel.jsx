import React from 'react';
import { HAP_COLORS } from '../utils/constants.js';
import { DEFAULT_VARIANT_FILTER, isDefaultVariantFilter } from '../utils/variantFilter.js';

/**
 * Variant-level quality filtering.
 *
 * Every control here re-evaluates the per-sample calls from the raw per-base
 * counts already held in the browser, so no file has to be regenerated on the
 * server. Defaults reproduce the precomputed summary exactly; the panel reports
 * when a non-default setting is in force so that a displayed haplotype count is
 * never ambiguous as to which thresholds produced it.
 */
function VariantFilterSection({ variantFilter, setVariantFilter, rawPileupReady, resetFilters }) {
  if (!variantFilter) return null;
  const vf = variantFilter;
  const set = (patch) => { setVariantFilter({ ...vf, ...patch }); resetFilters(); };
  const isDefault = isDefaultVariantFilter(vf);

  const Num = (label, key, min, max, step, hint) => (
    <div className="fp-vf-row" title={hint}>
      <span className="fp-vf-lbl">{label}</span>
      <input
        type="number" className="fp-pos-input" style={{ width: 62 }}
        min={min} max={max} step={step} value={vf[key]}
        disabled={!rawPileupReady}
        onChange={e => {
          const v = e.target.value === '' ? 0 : parseFloat(e.target.value);
          if (Number.isNaN(v)) return;
          set({ [key]: Math.min(max, Math.max(min, v)) });
        }}
      />
    </div>
  );

  return (
    <div className="fp-section">
      <div className="fp-section-title">
        Variant Filter{!isDefault && <span className="fp-vf-active"> · modified</span>}
      </div>

      {!rawPileupReady && <div className="fp-vf-note">Loading read counts…</div>}

      {Num('Min depth', 'minDepth', 0, 200, 1,
        'Cells with fewer reads than this are shown in grey and excluded from haplotype classification. 0 disables.')}

      {Num('Het freq', 'hetFreq', 0, 0.5, 0.05,
        'Cells at which the second allele reaches this fraction of the two commonest alleles are reported as heterozygous (H) and excluded from haplotype classification. 0 disables.')}

      <div className="fp-vf-note">
        Filtered cells are excluded from classification. Hover always reports the
        underlying read counts unchanged.
      </div>

      {!isDefault && (
        <button className="fp-btn" style={{ width: '100%', marginTop: 4 }}
          onClick={() => { setVariantFilter(DEFAULT_VARIANT_FILTER); resetFilters(); }}>
          Reset to defaults
        </button>
      )}
    </div>
  );
}

export default function FilterPanel({
  hapData, pileupProgress, samples,
  selectedHaps, setSelectedHaps, expandedHap, setExpandedHap,
  deselectedSamples, setDeselectedSamples,
  hapTarget, setHapTarget, customRange, setCustomRange,
  classifyFlags, setClassifyFlags,
  viewRegion, setViewRegion, viewFlags, setViewFlags,
  variantFilter, setVariantFilter, rawPileupReady,
  resetFilters,
}) {
  if (!hapData) return (
    <div className="fp-content">
      <div className="fp-loading">
        Computing haplotypes… ({Math.round(pileupProgress * 100)}%)
        <div className="fp-bar-bg"><div className="fp-bar-fill" style={{ width: `${pileupProgress * 100}%` }} /></div>
      </div>
    </div>
  );

  const allHapIds = hapData.haplotypes.map(h => h.id);

  const selectAll = () => { setSelectedHaps(new Set()); setDeselectedSamples(new Set()); setExpandedHap(null); };
  const deselectAll = () => { setSelectedHaps(new Set(allHapIds)); setDeselectedSamples(new Set(samples)); setExpandedHap(null); };
  const showReps = () => {
    setSelectedHaps(new Set(allHapIds));
    const reps = new Set(hapData.haplotypes.map(h => h.samples[0]).filter(Boolean));
    const desel = new Set();
    samples.forEach(s => { if (!reps.has(s)) desel.add(s); });
    setDeselectedSamples(desel);
    setExpandedHap(null);
  };

  const isHapVisible = (h) => {
    if (selectedHaps.size > 0 && !selectedHaps.has(h.id)) return false;
    return h.samples.some(s => !deselectedSamples.has(s));
  };

  const toggleHap = (hapId, hapSamples) => {
    const hap = hapData.haplotypes.find(h => h.id === hapId);
    const currentlyVisible = hap && isHapVisible(hap);
    if (currentlyVisible) {
      setDeselectedSamples(p => { const d = new Set(p); hapSamples.forEach(s => d.add(s)); return d; });
      setSelectedHaps(prev => { const n = prev.size === 0 ? new Set(allHapIds) : new Set(prev); n.delete(hapId); return n; });
    } else {
      setDeselectedSamples(p => { const d = new Set(p); hapSamples.forEach(s => d.delete(s)); return d; });
      setSelectedHaps(prev => { const n = prev.size === 0 ? new Set(allHapIds) : new Set(prev); n.add(hapId); if (n.size >= allHapIds.length) return new Set(); return n; });
    }
  };

  return (
    <div className="fp-content">
      {/* ─── Haplotype Classification ─── */}
      <div className="fp-section">
        <div className="fp-section-title">Haplotype Classification</div>
        <div className="fp-range">
          <span className="fp-range-lbl">Range</span>
          <button className={`fp-range-btn ${hapTarget === 'gene' ? 'active' : ''}`} onClick={() => { setHapTarget('gene'); resetFilters(); }}>Gene</button>
          <button className={`fp-range-btn ${hapTarget === 'cds' ? 'active' : ''}`} onClick={() => { setHapTarget('cds'); resetFilters(); }}>CDS</button>
          <button className={`fp-range-btn ${hapTarget === 'custom' ? 'active' : ''}`} onClick={() => { setHapTarget('custom'); resetFilters(); }}>Custom</button>
        </div>
        {hapTarget === 'custom' && (
          <div className="fp-custom-list">
            {customRange.map((r, i) => (
              <div key={i} className="fp-custom-row">
                <span className="fp-range-lbl" style={{color:'var(--t2)', fontSize:10}}>#{i+1}</span>
                <input type="number" className="fp-pos-input" placeholder="start"
                  value={r.start} onChange={e => { const a=[...customRange]; a[i]={...a[i],start:e.target.value}; setCustomRange(a); resetFilters(); }} />
                <span className="fp-pos-sep">~</span>
                <input type="number" className="fp-pos-input" placeholder="end"
                  value={r.end} onChange={e => { const a=[...customRange]; a[i]={...a[i],end:e.target.value}; setCustomRange(a); resetFilters(); }} />
                {customRange.length > 1 && (
                  <button className="fp-pos-del" onClick={() => { setCustomRange(customRange.filter((_,j)=>j!==i)); resetFilters(); }}>✕</button>
                )}
              </div>
            ))}
            <div className="fp-custom-actions">
              {customRange.length < 10 && (
                <button className="fp-pos-add" onClick={() => { setCustomRange([...customRange, {start:'',end:''}]); }}>+ Add position</button>
              )}
              <button className="fp-pos-reset" onClick={() => { setCustomRange([{start:'',end:''}]); resetFilters(); }}>Reset</button>
            </div>
          </div>
        )}
        {/* The variant-type selection applies to every scope, including Custom,
            where it was previously hidden although the classification honoured it. */}
        <div className="fp-checks">
          <span className="fp-range-lbl">Mode</span>
          <label className="fp-check"><input type="checkbox" checked={classifyFlags.snp} onChange={() => { const f = { ...classifyFlags, snp: !classifyFlags.snp }; if (!f.snp && !f.indel && !f.gap) return; setClassifyFlags(f); resetFilters(); }} /><span>SNP</span></label>
          <label className="fp-check"><input type="checkbox" checked={classifyFlags.indel} onChange={() => { const f = { ...classifyFlags, indel: !classifyFlags.indel }; if (!f.snp && !f.indel && !f.gap) return; setClassifyFlags(f); resetFilters(); }} /><span>InDel</span></label>
          <label className="fp-check"><input type="checkbox" checked={classifyFlags.gap} onChange={() => { const f = { ...classifyFlags, gap: !classifyFlags.gap }; if (!f.snp && !f.indel && !f.gap) return; setClassifyFlags(f); resetFilters(); }} /><span>Gap</span></label>
        </div>
      </div>

      {/* ─── Variant Filter ─── */}
      <VariantFilterSection
        variantFilter={variantFilter}
        setVariantFilter={setVariantFilter}
        rawPileupReady={rawPileupReady}
        resetFilters={resetFilters}
      />

      {/* ─── View Settings ─── */}
      <div className="fp-section">
        <div className="fp-section-title">View</div>
        <div className="fp-range">
          <span className="fp-range-lbl">Region</span>
          <button className={`fp-range-btn ${viewRegion === 'all' ? 'active' : ''}`} onClick={() => setViewRegion('all')}>All</button>
          <button className={`fp-range-btn ${viewRegion === 'gene' ? 'active' : ''}`} onClick={() => setViewRegion('gene')}>Gene</button>
          <button className={`fp-range-btn ${viewRegion === 'cds' ? 'active' : ''}`} onClick={() => setViewRegion('cds')}>CDS</button>
        </div>
        <div className="fp-checks">
          <span className="fp-range-lbl">Show</span>
          <label className="fp-check"><input type="checkbox" checked={viewFlags.identical} onChange={() => { const f = { ...viewFlags, identical: !viewFlags.identical }; if (!f.identical && !f.snp && !f.indel && !f.gap) return; setViewFlags(f); }} /><span>Identical</span></label>
          <label className="fp-check"><input type="checkbox" checked={viewFlags.snp} onChange={() => { const f = { ...viewFlags, snp: !viewFlags.snp }; if (!f.identical && !f.snp && !f.indel && !f.gap) return; setViewFlags(f); }} /><span>SNP</span></label>
          <label className="fp-check"><input type="checkbox" checked={viewFlags.indel} onChange={() => { const f = { ...viewFlags, indel: !viewFlags.indel }; if (!f.identical && !f.snp && !f.indel && !f.gap) return; setViewFlags(f); }} /><span>InDel</span></label>
          <label className="fp-check"><input type="checkbox" checked={viewFlags.gap} onChange={() => { const f = { ...viewFlags, gap: !viewFlags.gap }; if (!f.identical && !f.snp && !f.indel && !f.gap) return; setViewFlags(f); }} /><span>Gap</span></label>
        </div>
      </div>

      {/* ─── Sample Filter ─── */}
      <div className="fp-section">
        <div className="fp-section-title">Sample Filter</div>
        <div className="fp-actions">
          <button className="fp-btn" onClick={selectAll}>Select All</button>
          <button className="fp-btn" onClick={deselectAll}>Deselect All</button>
        </div>
        <button className="fp-btn fp-btn-accent" onClick={showReps} style={{ marginTop: 4, width: '100%' }}>★ Representatives</button>
        <div className="fp-summary">{hapData.haplotypes.length} haplotypes · {hapData.variantPositions.length} variants</div>

      </div>

      {hapData.haplotypes.map((h, i) => {
        const col = HAP_COLORS[i % HAP_COLORS.length];
        const isSel = isHapVisible(h);
        const isExp = expandedHap === h.id;
        return (
          <div key={h.id} className={`fp-hap ${isExp ? 'expanded' : ''}`}>
            <div className="fp-hap-hd" onClick={() => setExpandedHap(isExp ? null : h.id)}>
              <input type="checkbox" checked={isSel} style={{ accentColor: col }}
                onClick={e => { e.stopPropagation(); toggleHap(h.id, h.samples); }} readOnly />
              <span className="fp-hap-dot" style={{ background: col }} />
              <span className="fp-hap-name" style={{ color: col }}>{h.label}</span>
              <span className="fp-hap-n">{h.nSamples}</span>
              <span className="fp-hap-v">{h.nSnp || 0}s{h.nGap ? `+${h.nGap}g` : ''}{h.nIns ? `+${h.nIns}i` : ''}</span>
              <span className="fp-hap-arr">{isExp ? '▴' : '▾'}</span>
            </div>
            {isExp && (
              <div className="fp-samples">
                <div className="fp-smp-actions">
                  <span onClick={() => setDeselectedSamples(p => { const n = new Set(p); h.samples.forEach(s => n.delete(s)); return n; })}>Select All</span>
                  <span className="fp-sep">|</span>
                  <span onClick={() => setDeselectedSamples(p => { const n = new Set(p); h.samples.forEach(s => n.add(s)); return n; })}>Deselect All</span>
                </div>
                {h.samples.map(sid => (
                  <label key={sid} className="fp-smp">
                    <input type="checkbox" checked={!deselectedSamples.has(sid)} style={{ accentColor: col }}
                      onChange={() => setDeselectedSamples(p => { const n = new Set(p); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; })} />
                    <span>{sid}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
