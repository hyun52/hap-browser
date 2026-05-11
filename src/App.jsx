import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useGeneData } from './hooks/useGeneData.js';
import { computeCustomHaplotypes } from './utils/haplotype.js';
import { parseUserPos } from './utils/positionUtils.js';
import GenomeView from './components/GenomeView.jsx';
import CDSViewCanvas from './components/CDSViewCanvas.jsx';
import GenomeViewCanvas from './components/GenomeViewCanvas.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import BlastPanel from './components/BlastPanel.jsx';
import MarkerPanel from './components/MarkerPanel.jsx';
import HapMatrix from './components/HapMatrix.jsx';
import ExportModal from './components/ExportModal.jsx';
import VarietyUploadModal from './components/VarietyUploadModal.jsx';
import './app.css';

export default function App() {
  const {
    index, gene, samples, hapCombos, loading, pileupProgress,
    classifyFlags, setClassifyFlags, getHapData,
    loadIndex, loadGene, loadSamples, loadAllPileups,
    getPileup, getPositionData, getSampleIdxMap, getSampleList,
  } = useGeneData();

  const [sideOpen, setSideOpen] = useState(true);
  const [tab, setTab] = useState('view');
  const [showProtein, setShowProtein] = useState(false);
  const [hapTarget, setHapTarget] = useState('cds');
  const [customRange, setCustomRange] = useState([{ start: '', end: '' }]);
  const [viewRegion, setViewRegion] = useState('cds');
  const [viewFlags, setViewFlags] = useState({ identical: true, snp: true, indel: true, gap: true });
  const [collapsed, setCollapsed] = useState(new Set());
  const [selectedHaps, setSelectedHaps] = useState(new Set());
  const [expandedHap, setExpandedHap] = useState(null);
  const [deselectedSamples, setDeselectedSamples] = useState(new Set());

  // ── Feature #4: Position display mode ───────────────────────────────
  const [posMode, setPosMode] = useState('rapdb');

  // ── Feature #3: Position navigation ────────────────────────────────────
  const [gotoInput, setGotoInput] = useState('');
  const [gotoTarget, setGotoTarget] = useState(null); // local coordinate → passed to GenomeView
  const genomeViewRef = useRef(null);
  const gotoInputRef = useRef(null);

  // ── Feature #6: Summary-table modal ────────────────────────────────────
  const [showHapMatrix, setShowHapMatrix] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // ── Feature #1+2: Marker design panel ──────────────────────────────────
  const [markerDragRange, setMarkerDragRange] = useState(null); // { startPos, endPos }
  const [showMarker, setShowMarker] = useState(false);

  // ── C1: Dark mode ──────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('hb-theme') || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('hb-theme', theme); } catch {}
  }, [theme]);

  // ── A2: Recent gene history ───────────────────────────────────────────
  const [recentGenes, setRecentGenes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb-recent-genes') || '[]'); } catch { return []; }
  });
  const pushRecentGene = useCallback((gi) => {
    setRecentGenes(prev => {
      const filtered = prev.filter(g => g.id !== gi.id);
      const next = [{ id: gi.id, sym: gi.sym, strand: gi.strand }, ...filtered].slice(0, 5);
      try { localStorage.setItem('hb-recent-genes', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Sample variety metadata (user-uploaded, localStorage-persisted) ───
  // Structure: { [sampleId]: { variety: 'Basmati 370', ...optionalExtras } }
  const [sampleMeta, setSampleMeta] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb-sample-meta') || '{}'); } catch { return {}; }
  });
  const [showVarietyModal, setShowVarietyModal] = useState(false);

  const updateSampleMeta = useCallback((newMeta) => {
    setSampleMeta(newMeta);
    try { localStorage.setItem('hb-sample-meta', JSON.stringify(newMeta)); } catch {}
  }, []);

  const clearSampleMeta = useCallback(() => {
    updateSampleMeta({});
  }, [updateSampleMeta]);

  const handleSelectGene = useCallback(async (gi) => {
    // Fetch gene FA/GFF and samples.json in parallel (previously serial)
    const [g, slist] = await Promise.all([
      loadGene(gi),
      loadSamples(gi.id),
    ]);
    if (!g) return;
    pushRecentGene(gi);
    setSelectedHaps(new Set()); setExpandedHap(null); setDeselectedSamples(new Set()); setTab('view');
    setGotoInput(''); setGotoTarget(null); setShowMarker(false); setShowExport(false);
    setCustomRange([{ start: '', end: '' }]);
    if (slist.length > 0) loadAllPileups(gi.id, slist, g);
  }, [loadGene, loadSamples, loadAllPileups, pushRecentGene]);

  // Access latest handleSelectGene via ref — always use the latest closure without re-running the mount effect
  const handleSelectGeneRef = useRef(handleSelectGene);
  useEffect(() => { handleSelectGeneRef.current = handleSelectGene; }, [handleSelectGene]);

  useEffect(() => {
    (async () => {
      const idx = await loadIndex();
      if (idx?.groups?.[0]?.genes?.[0]) await handleSelectGeneRef.current(idx.groups[0].genes[0]);
    })();
  }, [loadIndex]);

  const resetFilters = () => {
    setSelectedHaps(new Set()); setExpandedHap(null); setDeselectedSamples(new Set());
  };

  // For A2 recent-genes search: flat gene list
  const flatGenes = useMemo(() => {
    if (!index?.groups) return [];
    return index.groups.flatMap(g => g.genes);
  }, [index]);

  const hapData = useMemo(() => {
    if (hapTarget === 'custom') {
      const posData = hapCombos?._regionPositionData;
      if (!posData || !gene || !samples.length) return null;
      const offset = gene?.offset || 0;
      const validRanges = customRange
        .filter(r => r.start !== '')
        .map(r => {
          const s = (parseInt(r.start) || 1) - offset;
          const e = (parseInt(r.end) || (parseInt(r.start) || 1)) - offset;
          return { start: Math.min(s, e), end: Math.max(s, e) };
        });
      if (!validRanges.length) return getHapData('gene', classifyFlags);
      const [first, ...rest] = validRanges;
      return computeCustomHaplotypes(posData, gene.seq, samples, classifyFlags, first.start, first.end, rest);
    }
    return getHapData(hapTarget, classifyFlags);
  }, [getHapData, hapTarget, classifyFlags, hapCombos, gene, samples, customRange]);

  const regionPositionData = useMemo(() => hapCombos?._regionPositionData || [], [hapCombos]);

  const hapInfo = useMemo(() => {
    if (!hapData) return '';
    const rangeLabel = hapTarget === 'cds' ? 'CDS' : hapTarget === 'gene' ? 'Gene' :
      `Custom (${customRange.filter(r=>r.start).map(r=>r.start+(r.end&&r.end!==r.start?'–'+r.end:'')).join(', ') || '?'})`;
    const flags = [classifyFlags.snp && 'SNP', classifyFlags.indel && 'InDel', classifyFlags.gap && 'Gap'].filter(Boolean).join('+');
    return `${rangeLabel} · ${flags} · ${hapData.haplotypes.length} haplotypes · ${hapData.variantPositions.length} variants`;
  }, [hapData, hapTarget, classifyFlags, customRange]);

  // sample → haplotype id mapping (memoized to avoid unnecessary GenomeViewCanvas re-renders)
  const sampleHapMap = useMemo(() => {
    const m = {};
    if (hapData) hapData.haplotypes.forEach(h => h.samples.forEach(s => { m[s] = h.id; }));
    return m;
  }, [hapData]);

  // Filtered sample list (memoized)
  const shownSamples = useMemo(() => {
    if (!hapData || !samples.length) return samples;
    let c = samples;
    if (selectedHaps.size > 0) c = c.filter(s => selectedHaps.has(sampleHapMap[s]));
    if (deselectedSamples.size > 0) c = c.filter(s => !deselectedSamples.has(s));
    return c;
  }, [hapData, samples, selectedHaps, deselectedSamples, sampleHapMap]);

  // ── Goto handler ────────────────────────────────────────────────────────
  // When viewRegion is gene/cds, build a Map from relative number → local (inverse) position
  const relToLocalMap = useMemo(() => {
    if (!gene || posMode === 'rapdb') return null;
    if (viewRegion === 'gene') {
      const gls = gene.gene_start - gene.offset;
      const gle = gene.gene_end - gene.offset;
      const m = new Map();
      for (let p = gls, i = 1; p <= gle; p++, i++) m.set(i, p);
      return m;
    }
    if (viewRegion === 'cds') {
      const targetMrnaIds = new Set();
      gene.features?.forEach(f => { if (f.type === 'mRNA' && f.attrs?.Locus_id === gene.id) targetMrnaIds.add(f.attrs.ID); });
      const cdsSet = new Set(); // Use Set to deduplicate
      gene.features?.forEach(f => {
        if ((f.type === 'CDS' || f.type === 'exon') && f.attrs?.Parent && targetMrnaIds.has(f.attrs.Parent)) {
          for (let p = f.start; p <= f.end; p++) cdsSet.add(p);
        }
      });
      const cdsPositions = [...cdsSet].sort((a, b) => a - b);
      const m = new Map();
      cdsPositions.forEach((p, i) => m.set(i + 1, p));
      return m;
    }
    return null;
  }, [gene, posMode, viewRegion]);

  const [gotoNotFound, setGotoNotFound] = useState(false);

  const handleGoto = useCallback(() => {
    if (!gene || !gotoInput) return;
    let localPos;
    if (posMode === 'rapdb') {
      localPos = parseUserPos(gotoInput, gene.offset, 'rapdb');
    } else if (relToLocalMap) {
      const n = parseInt(String(gotoInput).replace(/[,\s]/g, ''), 10);
      localPos = isNaN(n) ? null : (relToLocalMap.get(n) ?? null);
    } else {
      localPos = parseUserPos(gotoInput, gene.offset, 'local');
    }
    if (localPos === null || localPos < 1 || localPos > gene.region_length) {
      setGotoNotFound(true);
      setTimeout(() => setGotoNotFound(false), 2000);
      return;
    }
    setGotoTarget(localPos);
    setTimeout(() => setGotoTarget(null), 2000);
  }, [gotoInput, gene, posMode, relToLocalMap]);

  // ── Marker drag callback (GenomeView → App) ─────────────────────────────
  const handleColumnDragEnd = useCallback((startPos, endPos) => {
    setMarkerDragRange({ startPos: Math.min(startPos, endPos), endPos: Math.max(startPos, endPos) });
    setShowMarker(true);
  }, []);

  // ── Esc: close modals & blur inputs (minimal keybindings) ──────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      if (isTyping) { e.target.blur?.(); return; }
      if (showVarietyModal) { setShowVarietyModal(false); return; }
      if (showHapMatrix) { setShowHapMatrix(false); return; }
      if (showExport) { setShowExport(false); return; }
      if (showMarker) { setShowMarker(false); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showVarietyModal, showHapMatrix, showExport, showMarker]);

  const posData = gene ? getPositionData(gene.id) : null;

  return (
    <div className="app">
      {loading && <div className="loading-overlay">{loading}</div>}

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="nav">
        {/* Logo */}
        <div className="nav-logo"><div className="nav-dot" />HapBrowser</div>

        {/* Gene-selection button */}
        <button className={`nav-tab ${sideOpen ? 'active' : ''}`} onClick={() => setSideOpen(!sideOpen)}>
          ☰ Genes
        </button>

        {/* Current gene name */}
        {gene && (
          <div className="nav-gene-badge">
            <span className="nav-gene-sym">{gene.sym}</span>
            <span className="nav-gene-id">{gene.id}</span>
          </div>
        )}

        <div className="nav-sep" />

        {/* Goto */}
        {gene && (
          <div className="nav-goto">
            <input
              ref={gotoInputRef}
              className="nav-goto-input"
              placeholder={posMode === 'rapdb' ? 'RAP-DB pos' : viewRegion === 'gene' ? 'Gene pos (1-based)' : viewRegion === 'cds' ? 'CDS pos (1-based)' : 'Local pos'}
              value={gotoInput}
              onChange={e => setGotoInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGoto()}
            />
            <button className="nav-goto-btn" onClick={handleGoto}>Go</button>
          </div>
        )}
        {gotoNotFound && (
          <div style={{
            position:'fixed', top:52, left:'50%', transform:'translateX(-50%)',
            background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6,
            padding:'7px 18px', fontSize:12, color:'#b91c1c', textAlign:'center',
            zIndex:9999, boxShadow:'0 4px 12px rgba(0,0,0,.15)', fontWeight:600,
            pointerEvents:'none'
          }}>
            ⚠ Position not found
          </div>
        )}

        {/* Summary / Export */}
        <button className="nav-summary-btn" onClick={() => setShowHapMatrix(true)} title="Cross-gene haplotype analysis">
          🧬 HapMatrix
        </button>
        {hapData && gene && (
          <button className="nav-export-btn" onClick={() => setShowExport(true)} title="Export to CSV">
            ⬇ Export
          </button>
        )}

        {/* Protein button: overlay amino-acid rows on Genome View */}
        <button
          className={`nav-blast-btn ${showProtein ? 'active' : ''}`}
          onClick={() => {
            if (!showProtein) {
              setHapTarget('cds');
              setViewRegion('cds');
              setTab('view');
            }
            setShowProtein(p => !p);
          }}
          title="Toggle Codon / Amino acid rows"
        >
          🧬 Protein
        </button>
        {/* BLAST: small text button */}
        <button
          className={`nav-blast-btn ${tab === 'blast' ? 'active' : ''}`}
          onClick={() => setTab(tab === 'blast' ? 'view' : 'blast')}
        >
          BLAST
        </button>
        {/* Theme + Help + Varieties */}
        <button
          className="nav-blast-btn"
          onClick={() => setShowVarietyModal(true)}
          title="Upload sample → variety mapping"
          style={{ marginLeft: 4 }}
        >
          🏷 {Object.keys(sampleMeta).length > 0 && <span style={{fontSize:9,color:'var(--teal)',marginLeft:2}}>{Object.keys(sampleMeta).length}</span>}
        </button>
        <button
          className="nav-blast-btn"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀' : '🌙'}
        </button>
      </nav>

      <div className="body-row">
        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div className={`sidebar ${sideOpen ? 'open' : ''}`}>
          {recentGenes.length > 0 && (
            <>
              <div className="side-hd" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Recent</span>
                <span onClick={() => { setRecentGenes([]); try { localStorage.removeItem('hb-recent-genes'); } catch {} }}
                  style={{fontSize:9,color:'var(--t2)',cursor:'pointer',fontWeight:400,textTransform:'none',letterSpacing:0}}
                  title="Clear recent">clear</span>
              </div>
              <div style={{borderBottom:'1px solid var(--border)'}}>
                {recentGenes.map(rg => {
                  // Look up full gene info from index
                  const gi = flatGenes.find(g => g.id === rg.id) || rg;
                  return (
                    <div key={rg.id} className={`gi ${gene?.id === rg.id ? 'active' : ''}`}
                      onClick={() => handleSelectGene(gi)}
                      style={{paddingLeft:12}}>
                      <span className="gi-sym">{rg.sym}</span>
                      <span className="gi-id">{rg.id}</span>
                      <span className="gi-str">{rg.strand === '+' ? '→' : '←'}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div className="side-hd">Gene Navigator</div>
          <div className="gene-list">
            {index?.groups?.map(g => {
              const isC = collapsed.has(g.name);
              return (
                <div key={g.name} className="gene-group">
                  <div className="gg-hd" onClick={() => setCollapsed(p => {
                    const n = new Set(p);
                    if (n.has(g.name)) n.delete(g.name); else n.add(g.name);
                    return n;
                  })}>
                    <span className="gg-arr">{isC ? '▸' : '▾'}</span>
                    <span className="gg-name">{g.name}</span>
                    <span className="gg-count">{g.genes.length}</span>
                  </div>
                  {!isC && g.genes.map(gi => (
                    <div key={gi.id} className={`gi ${gene?.id === gi.id ? 'active' : ''}`}
                      onClick={() => handleSelectGene(gi)}>
                      <span className="gi-sym">{gi.sym}</span>
                      <span className="gi-id">{gi.id}</span>
                      <span className="gi-str">{gi.strand === '+' ? '→' : '←'}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Center ───────────────────────────────────────────────────── */}
        <div className="center">
          {gene && (
            <div className="infobar">
              <span className="ib-sym">{gene.sym}</span>
              <span className="ib-id">{gene.id}</span>
              <span className="ib-desc">{gene.desc?.slice(0, 80)}</span>
              <span className="ib-coords">
                {gene.chr}:{gene.region_start.toLocaleString()}–{gene.region_end.toLocaleString()}
                {' '}({gene.strand}) · {(gene.region_length / 1000).toFixed(1)}kb
              </span>
            </div>
          )}
          {pileupProgress > 0 && pileupProgress < 1 && (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${pileupProgress * 100}%` }} />
            </div>
          )}
          {tab === 'view' && hapCombos && gene && (
            <GenomeViewCanvas
              ref={genomeViewRef}
              gene={gene}
              hapData={hapData}
              regionPositionData={regionPositionData}
              shownSamples={shownSamples}
              sampleHapMap={sampleHapMap}
              getPileup={getPileup}
              viewRegion={viewRegion}
              viewFlags={viewFlags}
              samples={samples}
              posMode={posMode}
              onTogglePosMode={() => setPosMode(m => m === 'rapdb' ? 'local' : 'rapdb')}
              gotoTarget={gotoTarget}
              onColumnDragEnd={handleColumnDragEnd}
              sampleIdxMap={gene ? getSampleIdxMap(gene.id) : {}}
              sampleList={gene ? getSampleList(gene.id) : []}
              showProtein={showProtein}
              sampleMeta={sampleMeta}
            />
          )}
          {tab === 'view' && (!hapCombos || !gene) && (
            <div className="vo-empty">← Select a gene</div>
          )}
          {tab === 'blast' && (
            <BlastPanel
              gene={gene} hapData={hapData} index={index}
              getPileup={getPileup} hapInfo={hapInfo}
              hapTarget={hapTarget} customRange={customRange}
            />
          )}

        </div>

        {/* ── Right panel ──────────────────────────────────────────────── */}
        {gene && tab !== 'blast' && (
          <div className="right-panel">
            <div className="side-hd" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>CONTROL</span>
              <span style={{ fontSize: 9, color: '#888', fontWeight: 'normal' }}>
                {shownSamples.length} / {samples.length}
              </span>
            </div>
            <FilterPanel
              hapData={hapData} pileupProgress={pileupProgress} samples={samples}
              selectedHaps={selectedHaps} setSelectedHaps={setSelectedHaps}
              expandedHap={expandedHap} setExpandedHap={setExpandedHap}
              deselectedSamples={deselectedSamples} setDeselectedSamples={setDeselectedSamples}
              hapTarget={hapTarget} setHapTarget={setHapTarget}
              customRange={customRange} setCustomRange={setCustomRange}
              classifyFlags={classifyFlags} setClassifyFlags={setClassifyFlags}
              viewRegion={viewRegion} setViewRegion={setViewRegion}
              viewFlags={viewFlags} setViewFlags={setViewFlags}
              resetFilters={resetFilters}
            />
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showExport && (
        <ExportModal
          gene={gene}
          hapData={hapData}
          positionData={posData}
          shownSamples={shownSamples}
          posMode={posMode}
          sampleList={samples}
          getCachedAltRatio={genomeViewRef.current?.getCachedAltRatio}
          msaColumns={genomeViewRef.current?.getMsaColumns?.()}
          sampleInsMap={genomeViewRef.current?.getSampleInsMap?.()}
          viewRegion={viewRegion}
          viewFlags={viewFlags}
          showProtein={showProtein}
          sampleMeta={sampleMeta}
          onClose={() => setShowExport(false)}
        />
      )}
      <div style={{ position:'fixed', inset:0, zIndex:1500, overflowY:'auto', background:'var(--bg1)', display: showHapMatrix ? 'block' : 'none' }}>
        <HapMatrix
          geneIndex={index || []}
          sampleMeta={sampleMeta}
          onClose={() => setShowHapMatrix(false)}
        />
      </div>
      {showMarker && markerDragRange && (
        <MarkerPanel
          gene={gene}
          positionData={posData}
          hapData={hapData}
          sampleList={gene ? getSampleList(gene.id) : []}
          sampleMeta={sampleMeta}
          dragRange={markerDragRange}
          onClose={() => setShowMarker(false)}
        />
      )}

      {/* ── Variety upload modal ───────────────────────────────────── */}
      {showVarietyModal && (
        <VarietyUploadModal
          currentMeta={sampleMeta}
          onApply={updateSampleMeta}
          onClose={() => setShowVarietyModal(false)}
        />
      )}
    </div>
  );
}
