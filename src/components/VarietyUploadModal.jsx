import React, { useState, useMemo, useRef } from 'react';

/**
 * VarietyUploadModal
 *
 * Parses and stores a sample→variety mapping from user-provided TSV/CSV.
 *
 * Accepted formats:
 *  1. Minimal: `sample_id\tvariety`   (header optional; if 2 columns, treated as id,variety)
 *  2. With header: if first line contains one of `sample_id`, `sampleid`, `sample`, `id` → that is the ID column
 *                 one of `variety`, `cultivar`, `name`, `accession_name` → variety column
 *                 any other columns are stored as optional meta
 *  3. Delimiter: tab or comma auto-detected
 *
 * Result: { [sampleId]: { variety, ...otherCols } }
 */
export default function VarietyUploadModal({ currentMeta, onApply, onClose }) {
  const [text, setText] = useState(() => {
    // If meta already stored, restore as TSV for editing
    const entries = Object.entries(currentMeta || {});
    if (!entries.length) return '';
    const cols = new Set(['variety']);
    entries.forEach(([, v]) => Object.keys(v || {}).forEach(k => cols.add(k)));
    const colList = Array.from(cols);
    const header = ['sample_id', ...colList].join('\t');
    const rows = entries.map(([sid, v]) =>
      [sid, ...colList.map(c => v?.[c] ?? '')].join('\t')
    );
    return [header, ...rows].join('\n');
  });
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  // ── parse preview ────────────────────────────────────────────────────
  const parsed = useMemo(() => {
    if (!text.trim()) return { meta: {}, extraCols: [], nRows: 0, error: '' };
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { meta: {}, extraCols: [], nRows: 0, error: '' };

    // Delimiter detection (tab first, else comma)
    const delim = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : '\t');
    const rows = lines.map(l => l.split(delim).map(c => c.trim()));

    // Header detection
    const ID_KEYS = new Set(['sample_id', 'sampleid', 'sample', 'id']);
    const VAR_KEYS = new Set(['variety', 'cultivar', 'name', 'accession_name', 'accession']);
    const lower0 = rows[0].map(c => c.toLowerCase());
    const hasHeader = lower0.some(c => ID_KEYS.has(c)) || lower0.some(c => VAR_KEYS.has(c));

    let header, dataRows;
    if (hasHeader) {
      header = lower0;
      dataRows = rows.slice(1);
    } else {
      // No header: 2 cols → [id, variety], more → [id, variety, col3, col4...]
      header = rows[0].length === 2
        ? ['sample_id', 'variety']
        : ['sample_id', 'variety', ...rows[0].slice(2).map((_, i) => `col${i+3}`)];
      dataRows = rows;
    }

    const idIdx = header.findIndex(h => ID_KEYS.has(h));
    const varIdx = header.findIndex(h => VAR_KEYS.has(h));
    if (idIdx < 0) return { meta: {}, extraCols: [], nRows: 0, error: 'No ID column found (expected: sample_id / id / sample)' };
    if (varIdx < 0) return { meta: {}, extraCols: [], nRows: 0, error: 'No variety column found (expected: variety / cultivar / name)' };

    const extraCols = header
      .map((h, i) => (i !== idIdx && i !== varIdx && h) ? { key: h, idx: i } : null)
      .filter(Boolean);

    const meta = {};
    let skipped = 0;
    for (const r of dataRows) {
      const sid = r[idIdx];
      const variety = r[varIdx];
      if (!sid || !variety) { skipped++; continue; }
      const entry = { variety };
      extraCols.forEach(({ key, idx }) => {
        if (r[idx]) entry[key] = r[idx];
      });
      meta[sid] = entry;
    }
    return { meta, extraCols: extraCols.map(c => c.key), nRows: Object.keys(meta).length, skipped, error: '' };
  }, [text]);

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setText(e.target.result);
    reader.readAsText(file);
  };

  const handleApply = () => {
    if (parsed.error || !parsed.nRows) return;
    onApply(parsed.meta);
    onClose();
  };

  const handleClear = () => {
    setText('');
    setFileName('');
  };

  // "Load example" button: 15-entry preview
  const sampleSmall = `sample_id\tvariety
ERS467893\tIRIS 313-8256
ERS467845\tIRIS 313-9438
ERS467800\tIRIS 313-9814
ERS467848\tIRIS 313-9880
ERS467798\tIRIS 313-8890
ERS468515\tIRIS 313-8204
ERS468513\tIRIS 313-8135
ERS468557\tIRIS 313-8137
ERS468632\tIRIS 313-8168
ERS468529\tIRIS 313-8177
ERS468520\tIRIS 313-8171
ERS468633\tIRIS 313-8166
ERS468471\tIRIS 313-8109
ERS470235\tB017
ERS470506\tCX142`;

  // "Load full" button: actual 200 research samples
  const sampleFull = `sample_id\tvariety
ERS467893\tIRIS 313-8256
ERS467845\tIRIS 313-9438
ERS467800\tIRIS 313-9814
ERS467848\tIRIS 313-9880
ERS467798\tIRIS 313-8890
ERS468515\tIRIS 313-8204
ERS468513\tIRIS 313-8135
ERS468557\tIRIS 313-8137
ERS468632\tIRIS 313-8168
ERS468529\tIRIS 313-8177
ERS468520\tIRIS 313-8171
ERS468633\tIRIS 313-8166
ERS468471\tIRIS 313-8109
ERS468488\tIRIS 313-8111
ERS468531\tIRIS 313-8112
ERS468635\tIRIS 313-8165
ERS468489\tIRIS 313-8085
ERS468637\tIRIS 313-8158
ERS468638\tIRIS 313-8159
ERS468639\tIRIS 313-8160
ERS468604\tIRIS 313-7870
ERS468548\tIRIS 313-8037
ERS468466\tIRIS 313-8113
ERS468464\tIRIS 313-8114
ERS468512\tIRIS 313-8099
ERS468497\tIRIS 313-8087
ERS468503\tIRIS 313-8066
ERS468462\tIRIS 313-8026
ERS468465\tIRIS 313-8029
ERS468523\tIRIS 313-8075
ERS468472\tIRIS 313-8025
ERS468517\tIRIS 313-8119
ERS468538\tIRIS 313-8033
ERS468505\tIRIS 313-8049
ERS468487\tIRIS 313-8039
ERS468527\tIRIS 313-8208
ERS468468\tIRIS 313-8195
ERS468514\tIRIS 313-8090
ERS468646\tIRIS 313-8170
ERS468469\tIRIS 313-8214
ERS468508\tIRIS 313-8050
ERS468507\tIRIS 313-8123
ERS468500\tIRIS 313-8200
ERS468502\tIRIS 313-8032
ERS468539\tIRIS 313-8125
ERS468480\tIRIS 313-8126
ERS468482\tIRIS 313-8127
ERS468665\tIRIS 313-8128
ERS468490\tIRIS 313-8024
ERS468506\tIRIS 313-8129
ERS468674\tIRIS 313-8162
ERS468477\tIRIS 313-8053
ERS468494\tIRIS 313-8138
ERS468460\tIRIS 313-8205
ERS468699\tIRIS 313-8140
ERS468481\tIRIS 313-8141
ERS468485\tIRIS 313-8142
ERS468493\tIRIS 313-8095
ERS468546\tIRIS 313-8143
ERS468491\tIRIS 313-8052
ERS468534\tIRIS 313-8096
ERS468710\tIRIS 313-8147
ERS468496\tIRIS 313-8105
ERS468511\tIRIS 313-8148
ERS468499\tIRIS 313-8149
ERS468474\tIRIS 313-8097
ERS468498\tIRIS 313-8151
ERS468544\tIRIS 313-8164
ERS468640\tIRIS 313-8167
ERS468317\tIRIS 313-8502
ERS468376\tIRIS 313-8400
ERS468356\tIRIS 313-10083
ERS468360\tIRIS 313-10093
ERS468354\tIRIS 313-10057
ERS468328\tIRIS 313-9463
ERS468413\tIRIS 313-10061
ERS468341\tIRIS 313-9884
ERS468427\tIRIS 313-10094
ERS468363\tIRIS 313-10119
ERS468337\tIRIS 313-9790
ERS468330\tIRIS 313-9698
ERS468358\tIRIS 313-10089
ERS467889\tIRIS 313-9811
ERS468426\tIRIS 313-10082
ERS468362\tIRIS 313-10111
ERS468315\tIRIS 313-9995
ERS467847\tIRIS 313-9759
ERS468340\tIRIS 313-9839
ERS468419\tIRIS 313-10074
ERS468407\tIRIS 313-9789
ERS468346\tIRIS 313-9937
ERS468420\tIRIS 313-10075
ERS468357\tIRIS 313-10084
ERS468421\tIRIS 313-10076
ERS468338\tIRIS 313-9813
ERS468339\tIRIS 313-9838
ERS468349\tIRIS 313-9964
ERS468347\tIRIS 313-9961
ERS468345\tIRIS 313-9891
ERS468365\tIRIS 313-10379
ERS468370\tIRIS 313-10373
ERS467900\tIRIS 313-10258
ERS467797\tIRIS 313-8399
ERS468316\tIRIS 313-8444
ERS467761\tIRIS 313-15904
ERS468336\tIRIS 313-9782
ERS468415\tIRIS 313-10065
ERS468368\tIRIS 313-10242
ERS468832\tIRIS 313-11655
ERS469441\tIRIS 313-10583
ERS469483\tIRIS 313-10618
ERS469429\tIRIS 313-10570
ERS469369\tIRIS 313-10430
ERS469187\tIRIS 313-12054
ERS469370\tIRIS 313-10469
ERS469193\tIRIS 313-12060
ERS469365\tIRIS 313-10453
ERS468829\tIRIS 313-11653
ERS469421\tIRIS 313-10563
ERS468734\tIRIS 313-11536
ERS468723\tIRIS 313-11522
ERS468838\tIRIS 313-11661
ERS469988\tIRIS 313-11198
ERS470235\tB017
ERS470506\tCX142
ERS470251\tB034
ERS470502\tCX139
ERS470234\tB016
ERS470240\tB023
ERS470260\tB045
ERS470219\tB001
ERS470380\tB170
ERS470376\tB166
ERS470435\tB236
ERS470384\tB179
ERS470608\tCX306
ERS470377\tB167
ERS470261\tB046
ERS470704\tCX534
ERS470232\tB014
ERS470269\tB055
ERS470262\tB047
ERS470378\tB168
ERS468533\tIRIS 313-8027
ERS468519\tIRIS 313-8084
ERS468532\tIRIS 313-8115
ERS468526\tIRIS 313-8154
ERS468483\tIRIS 313-8116
ERS468475\tIRIS 313-8118
ERS468501\tIRIS 313-8121
ERS468479\tIRIS 313-8124
ERS468484\tIRIS 313-8216
ERS468542\tIRIS 313-8132
ERS468516\tIRIS 313-8031
ERS468682\tIRIS 313-8217
ERS468536\tIRIS 313-8139
ERS468476\tIRIS 313-8145
ERS468335\tIRIS 313-9774
ERS467809\tIRIS 313-9140
ERS468393\tIRIS 313-9176
ERS468325\tIRIS 313-9233
ERS468326\tIRIS 313-9379
ERS468416\tIRIS 313-10067
ERS468343\tIRIS 313-9887
ERS468418\tIRIS 313-10073
ERS468332\tIRIS 313-9702
ERS468344\tIRIS 313-9890
ERS468408\tIRIS 313-9800
ERS468321\tIRIS 313-8856
ERS468318\tIRIS 313-8665
ERS469957\tIRIS 313-11156
ERS468952\tIRIS 313-11803
ERS469993\tIRIS 313-11202
ERS469422\tIRIS 313-10564
ERS469088\tIRIS 313-11890
ERS468827\tIRIS 313-11651
ERS469141\tIRIS 313-12003
ERS469769\tIRIS 313-10967
ERS469192\tIRIS 313-12059
ERS469259\tIRIS 313-12217
ERS469194\tIRIS 313-12061
ERS469954\tIRIS 313-11153
ERS469118\tIRIS 313-11973
ERS469146\tIRIS 313-11981
ERS469656\tIRIS 313-10853
ERS469642\tIRIS 313-10839
ERS469991\tIRIS 313-11201
ERS470636\tCX351
ERS470639\tCX354
ERS470473\tCX109
ERS470696\tCX47
ERS470675\tCX389
ERS470731\tCX78
ERS470618\tCX32
ERS470615\tCX317
ERS470388\tB183
ERS470222\tB004
ERS470223\tB005
ERS470677\tCX391
ERS470221\tB003`;

  // Short example for empty-textarea placeholder
  const placeholderText = `sample_id\tvariety
ERS467893\tIRIS 313-8256
ERS467845\tIRIS 313-9438
ERS470235\tB017`;

  return (
    <div
      onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:2000,
        display:'flex', alignItems:'center', justifyContent:'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:'var(--bg1)', color:'var(--t0)', border:'1px solid var(--border)',
          borderRadius:8, padding:'20px 24px', width:560, maxWidth:'92vw',
          maxHeight:'88vh', overflow:'auto',
          boxShadow:'0 10px 40px rgba(0,0,0,.3)', fontFamily:'var(--sans)', fontSize:12 }}
      >
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <h3 style={{ margin:0, fontSize:14, fontWeight:700, color:'var(--teal)' }}>
            🏷 Sample varieties
          </h3>
          <button onClick={onClose}
            style={{ border:'none', background:'none', cursor:'pointer', fontSize:16, color:'var(--t2)' }}>✕</button>
        </div>

        <div style={{ fontSize:11, color:'var(--t1)', lineHeight:1.6, marginBottom:12 }}>
          Paste or upload a TSV/CSV mapping sample IDs to variety/cultivar names.<br/>
          <span style={{ color:'var(--t2)' }}>
            Required columns: <code style={{ background:'var(--bg2)', padding:'1px 5px', borderRadius:3 }}>sample_id</code>{' '}
            & <code style={{ background:'var(--bg2)', padding:'1px 5px', borderRadius:3 }}>variety</code>.{' '}
            Additional columns (e.g. subpop, country) stored as optional metadata.
          </span>
        </div>

        {/* File upload */}
        <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center' }}>
          <input
            type="file"
            ref={fileRef}
            accept=".tsv,.csv,.txt"
            onChange={(e) => handleFile(e.target.files?.[0])}
            style={{ display:'none' }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            style={{ padding:'5px 12px', fontSize:11, cursor:'pointer',
              border:'1px solid var(--border)', borderRadius:5,
              background:'var(--bg2)', color:'var(--t0)' }}>
            📁 Upload file
          </button>
          {fileName && <span style={{ fontSize:10, color:'var(--t2)' }}>{fileName}</span>}
          <button
            onClick={() => setText(sampleSmall)}
            style={{ padding:'5px 10px', fontSize:11, cursor:'pointer',
              border:'1px solid var(--border)', borderRadius:5,
              background:'var(--bg2)', color:'var(--t1)', marginLeft:'auto' }}>
            Load example (15)
          </button>
          <button
            onClick={() => setText(sampleFull)}
            style={{ padding:'5px 10px', fontSize:11, cursor:'pointer',
              border:'1px solid var(--teal)', borderRadius:5,
              background:'var(--bg2)', color:'var(--teal)', fontWeight:600 }}>
            Load full (200)
          </button>
        </div>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={`Example:\n${placeholderText}`}
          style={{ width:'100%', height:220, padding:8, boxSizing:'border-box',
            fontFamily:'var(--mono)', fontSize:11, resize:'vertical',
            border:'1px solid var(--border)', borderRadius:5,
            background:'var(--bg1)', color:'var(--t0)', outline:'none' }}
        />

        {/* Parse-result preview */}
        <div style={{ marginTop:10, fontSize:11, minHeight:20 }}>
          {parsed.error && (
            <div style={{ color:'#b91c1c', background:'#fef2f2', border:'1px solid #fecaca',
              padding:'6px 10px', borderRadius:4 }}>⚠ {parsed.error}</div>
          )}
          {!parsed.error && parsed.nRows > 0 && (
            <div style={{ color:'#166534', background:'#f0fdf4', border:'1px solid #bbf7d0',
              padding:'6px 10px', borderRadius:4 }}>
              ✓ {parsed.nRows} samples parsed
              {parsed.skipped > 0 && <span style={{ color:'#ca8a04', marginLeft:8 }}>({parsed.skipped} skipped — missing id or variety)</span>}
              {parsed.extraCols.length > 0 && (
                <span style={{ color:'var(--t2)', marginLeft:8 }}>
                  · extra: {parsed.extraCols.join(', ')}
                </span>
              )}
            </div>
          )}
          {!parsed.error && !parsed.nRows && !text.trim() && (
            <div style={{ color:'var(--t2)' }}>
              Currently: {Object.keys(currentMeta || {}).length} sample{Object.keys(currentMeta||{}).length===1?'':'s'} with variety info saved.
            </div>
          )}
        </div>

        {/* Buttons */}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
          <button onClick={handleClear}
            style={{ padding:'6px 14px', fontSize:11, cursor:'pointer',
              border:'1px solid var(--border)', borderRadius:5,
              background:'transparent', color:'var(--t2)' }}>
            Clear input
          </button>
          <button onClick={() => { onApply({}); onClose(); }}
            style={{ padding:'6px 14px', fontSize:11, cursor:'pointer',
              border:'1px solid #fecaca', borderRadius:5,
              background:'#fef2f2', color:'#b91c1c' }}>
            Remove all saved
          </button>
          <button onClick={onClose}
            style={{ padding:'6px 14px', fontSize:11, cursor:'pointer',
              border:'1px solid var(--border)', borderRadius:5,
              background:'var(--bg2)', color:'var(--t1)' }}>
            Cancel
          </button>
          <button onClick={handleApply}
            disabled={parsed.error || !parsed.nRows}
            style={{ padding:'6px 16px', fontSize:11, fontWeight:600, cursor: (parsed.error || !parsed.nRows) ? 'default' : 'pointer',
              border:'none', borderRadius:5,
              background: (parsed.error || !parsed.nRows) ? 'var(--bg3)' : 'var(--accent)',
              color: (parsed.error || !parsed.nRows) ? 'var(--t2)' : '#fff' }}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
