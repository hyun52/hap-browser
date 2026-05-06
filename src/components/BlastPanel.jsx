import React, { useState, useMemo } from 'react';
import { HAP_COLORS } from '../utils/constants.js';
import { getDominantAllele } from '../utils/haplotype.js';

export default function BlastPanel({ gene, hapData, index, getPileup, allGenes, loadGeneForBlast, hapInfo, hapTarget, customRange }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [exampleAnswer, setExampleAnswer] = useState(null);

  // Build sample → haplotype map from current hapData
  const sampleHapMap = useMemo(() => {
    const map = {};
    if (hapData) hapData.haplotypes.forEach(h => h.samples.forEach(s => { map[s] = h.id; }));
    return map;
  }, [hapData]);

  // Classification label for table header
  const classLabel = useMemo(() => {
    if (hapTarget === 'gene') return 'Gene Hap';
    if (hapTarget === 'cds') return 'CDS Hap';
    const s = customRange?.start || '';
    const e = customRange?.end || s;
    return s === e ? `Hap (pos ${s || '?'})` : `Hap (${s || '?'}–${e || '?'})`;
  }, [hapTarget, customRange]);

  const downloadTsv = (hits) => {
    const header = ['#', 'Gene', 'Gene_ID', 'Sample', 'Identity(%)', 'Align_Length', 'Score', 'E-value', classLabel].join('\t');
    const rows = hits.map((h, i) =>
      [i + 1, h.gene_sym, h.gene_id, h.sample_id, h.identity, h.align_length, h.score, h.evalue,
       sampleHapMap[h.sample_id] || '?'].join('\t')
    );
    const tsv = [header, ...rows].join('\n');
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'blast_results.tsv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSearch = async () => {
    const raw = query.replace(/^>.*\n?/gm, '').replace(/[^ATGCatgcNn]/g, '');
    if (raw.length < 15) { setError('Too short (min 15bp)'); return; }
    setSearching(true); setError(''); setResults(null);
    try {
      const res = await fetch('/api/blast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: raw }),
      });
      const text = await res.text();
      if (!text) { setError('Empty response from server'); setSearching(false); return; }
      let data;
      try { data = JSON.parse(text); } catch { setError(`Invalid response: ${text.slice(0, 200)}`); setSearching(false); return; }
      if (!res.ok) { setError(`Server ${res.status}: ${data.detail || JSON.stringify(data)}`); setSearching(false); return; }
      setResults(data);
    } catch (err) {
      setError(`Cannot reach BLAST server.\nRun: npm run dev\n\n${err.message}`);
    } finally { setSearching(false); }
  };

  const loadMystery = () => {
    if (!gene?.seq || !getPileup) { setError('Select a gene first to load pileup data.'); return; }
    let sampleId;
    if (hapData?.haplotypes?.length) {
      const nonRefHaps = hapData.haplotypes.filter(h => h.nVariants > 0);
      const targetHap = nonRefHaps.length > 0
        ? nonRefHaps[Math.floor(Math.random() * nonRefHaps.length)]
        : hapData.haplotypes[Math.floor(Math.random() * hapData.haplotypes.length)];
      sampleId = targetHap.samples[Math.floor(Math.random() * targetHap.samples.length)];
    } else { setError('Wait for haplotype computation to complete.'); return; }

    const pileup = getPileup(gene.id, sampleId);
    if (!pileup) { setError('Pileup not loaded yet. Wait for loading to complete.'); return; }

    const gls = gene.gene_start - gene.offset;
    const gle = gene.gene_end - gene.offset;
    const chunk = [];
    for (let pos = Math.max(1, gls); pos <= Math.min(gene.seq.length, gle); pos++) {
      const ref = gene.seq[pos - 1] || 'N';
      const info = getDominantAllele(pileup, pos, ref);
      if (info.isNoCov || info.depth === 0) continue;
      chunk.push(info.isDel ? '' : info.base);
    }
    const seq = chunk.join('');
    setQuery(`>mystery_sample (${seq.length}bp)\n${seq}`);
    setExampleAnswer({ gene: gene.sym, geneId: gene.id, sample: sampleId });
  };

  return (
    <div className="blast-wrap">
      {hapInfo && (
        <div className="blast-hap-info">
          <span className="blast-hap-info-label">Current Haplotype:</span> {hapInfo}
        </div>
      )}
      <div className="blast-hd">
        <h3>🔍 BLAST Haplotype Search</h3>
        <p>Paste your sequencing result to identify which gene, sample, and haplotype it matches.</p>
        <p className="blast-sub">
          DB: {index?.groups?.reduce((a, g) => a + g.genes.length, 0) || 13} genes × 135 samples.
        </p>
      </div>
      <div className="blast-input">
        <label>Query Sequence (FASTA or raw nucleotide, &gt;500bp recommended)</label>
        <textarea rows={8} value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSearch(); }}
          placeholder={`Paste your sequence here, or click "Mystery Sample" to test.`}
          spellCheck={false} />
        <div className="blast-btns">
          <button className="blast-search" onClick={handleSearch}
            disabled={searching || query.replace(/^>.*\n?/gm, '').replace(/[^ATGCatgcNn]/g, '').length < 15}>
            {searching ? 'Searching…' : '🔍 Search'}</button>
          <button className="blast-example" onClick={loadMystery}>🎲 Mystery Sample</button>
          <button className="blast-clear" onClick={() => { setQuery(''); setResults(null); setError(''); setExampleAnswer(null); }}>Clear</button>
          <span className="blast-hint">Ctrl+Enter</span>
        </div>
      </div>
      {error && <div className="blast-error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}

      {exampleAnswer && results && (
        <div className="blast-answer">
          💡 Answer: <b>{exampleAnswer.gene}</b> ({exampleAnswer.geneId}) — sample <b>{exampleAnswer.sample}</b>
        </div>
      )}

      {results && (
        <div className="blast-results">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <h4 style={{ margin: 0 }}>Results ({results.hits?.length || 0} hits, query {results.query_length}bp)</h4>
            {results.hits?.length > 0 && (
              <button className="blast-dl" onClick={() => downloadTsv(results.hits)}>📥 Download TSV</button>
            )}
          </div>
          {results.hits?.length > 0 ? (
            <table className="blast-table">
              <thead>
                <tr>
                  <th>#</th><th>Gene</th><th>Sample</th><th>Identity</th><th>Align</th><th>Score</th><th>E-value</th>
                  <th>{classLabel}</th>
                </tr>
              </thead>
              <tbody>{results.hits.slice(0, 30).map((h, i) => {
                const hapId = sampleHapMap[h.sample_id];
                const hapIdx = hapData?.haplotypes?.findIndex(hp => hp.id === hapId);
                const hapColor = hapIdx >= 0 ? HAP_COLORS[hapIdx % HAP_COLORS.length] : '#888';
                return (
                  <tr key={i} className={i === 0 ? 'blast-best' : ''}>
                    <td>{i + 1}</td>
                    <td className="blast-gene-td">{h.gene_sym} <span className="blast-gid">{h.gene_id}</span></td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{h.sample_id}</td>
                    <td><span className={`blast-ident ${h.identity >= 99 ? 'high' : h.identity >= 95 ? 'mid' : 'low'}`}>{h.identity}%</span></td>
                    <td>{h.align_length}bp</td>
                    <td>{h.score}</td>
                    <td>{h.evalue}</td>
                    <td style={{ fontWeight: 600, color: hapColor }}>{hapId || '?'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : <div className="blast-nomatch">No matching samples found. Try a longer query (&gt;500bp).</div>}
        </div>
      )}
    </div>
  );
}
