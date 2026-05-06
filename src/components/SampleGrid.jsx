/**
 * SampleGrid.jsx
 * AG Grid Community-based sample-row renderer.
 * - Header (positions) pinned: pinnedTopRowData or suppressMovableColumns
 * - Left column (sample names) pinned: pinned: 'left'
 * - Cell virtualization: provided by AG Grid
 */

import React, { useMemo, useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

import 'ag-grid-community/styles/ag-grid.css';

const COL_W = 24;
const ROW_H = 20;

// Base colors
const BASE_BG = { A: '#1d6fba', T: '#15803d', G: '#b35a00', C: '#c41c1c' };
const HAP_COLORS = [
  '#2563eb','#15803d','#b35a00','#c41c1c',
  '#7c3aed','#be185d','#0f766e','#92400e',
  '#4f46e5','#059669','#d97706','#dc2626',
];

// ── Cell renderer: variant color display ───────────────────────────────────
function VariantCellRenderer({ value, data }) {
  if (!value || value === '.') {
    return <span style={{ color: '#ccc', fontSize: 10 }}>·</span>;
  }
  if (value === '-') {
    return <span style={{ background: '#e2e0db', display: 'block', width: '100%', height: '100%' }} />;
  }
  if (value === 'D') {
    return (
      <span style={{
        background: '#c8c5be', display: 'block',
        width: '100%', height: '100%', position: 'relative',
      }}>
        <span style={{
          position: 'absolute', top: '50%', left: '10%', right: '10%',
          height: 1, background: '#9a9690', transform: 'translateY(-50%)',
        }} />
      </span>
    );
  }
  const base = value[0];
  const isIns = value.includes('+');
  const bg = BASE_BG[base] || '#666';
  return (
    <span style={{
      background: bg, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '100%', height: '100%', fontSize: 10, fontWeight: 700,
      fontFamily: '"JetBrains Mono", monospace', position: 'relative',
    }}>
      {base}
      {isIns && <sup style={{ fontSize: 7, color: '#c4b5fd', position: 'absolute', top: 2, right: 2 }}>+</sup>}
    </span>
  );
}

// ── Sample-name cell renderer ──────────────────────────────────────────────
function SampleCellRenderer({ value, data }) {
  const color = data?._groupColor || '#888';
  return (
    <span style={{
      display: 'flex', alignItems: 'center', height: '100%',
      borderLeft: `3px solid ${color}`,
      paddingLeft: 5, fontSize: 10,
      fontFamily: '"JetBrains Mono", monospace',
      color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {value}
    </span>
  );
}

// ── Group-header cell renderer ─────────────────────────────────────────────
function GroupCellRenderer({ value, data }) {
  const color = data?._groupColor || '#888';
  return (
    <span style={{
      display: 'flex', alignItems: 'center', height: '100%',
      paddingLeft: 5, fontSize: 11, fontWeight: 700, color,
      fontFamily: '"JetBrains Mono", monospace',
      background: color + '15',
    }}>
      {value}
      {data?._groupMeta && (
        <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 400, color: '#888' }}>
          {data._groupMeta}
        </span>
      )}
    </span>
  );
}

export default function SampleGrid({
  groups,
  gene,
  msaColumns,       // [{ type:'ref'|'ins', pos, ... }]
  positionData,
  sampleIdxMap,
  sampleList,
  sampleInsMap,
  onHover,
  onLeave,
  posMode,
}) {
  const gridRef = useRef(null);

  // positionData map
  const pdMap = useMemo(() => {
    const m = new Map();
    (positionData || []).forEach(pd => m.set(pd.pos, pd));
    return m;
  }, [positionData]);

  // allele lookup
  const getAllele = useCallback((pd, si, refBase) => {
    if (!pd) return null; // same as ref
    if (pd.enc !== undefined) {
      if (si < 0 || si >= pd.enc.length) return null;
      const c = pd.enc[si];
      if (c === '0') return null;
      if (c === '-') return '-';
      const altIdx = parseInt(c) - 1;
      return altIdx < (pd.alt || []).length ? pd.alt[altIdx] : null;
    }
    if (pd.alleles) {
      const sid = sampleList[si];
      const a = sid ? pd.alleles[sid] : undefined;
      return a ?? null;
    }
    return null;
  }, [sampleList]);

  // ── Column Definitions ──────────────────────────────────────────────────
  const columnDefs = useMemo(() => {
    if (!msaColumns?.length || !gene) return [];

    // First column: sample name (pinned)
    const cols = [{
      field: '_label',
      headerName: `${gene.sym} (${gene.strand === '+' ? '→' : '←'})`,
      width: 130, pinned: 'left', lockPinned: true,
      cellRenderer: (params) => params.data?._isGroup
        ? <GroupCellRenderer {...params} />
        : <SampleCellRenderer value={params.value} data={params.data} />,
      suppressMovable: true, sortable: false, filter: false,
      cellStyle: { padding: 0, borderRight: '1px solid #e8e6e0' },
      headerClass: 'ag-sample-header',
    }];

    // Data columns: based on msaColumns
    msaColumns.forEach((col, ci) => {
      const pos = col.type === 'ref' ? col.pos : col.afterPos;
      const rapPos = pos + (gene.offset || 0);
      const displayPos = posMode === 'rapdb'
        ? rapPos.toLocaleString()
        : String(pos);

      cols.push({
        field: `col_${ci}`,
        headerName: col.type === 'ins' ? '·' : displayPos,
        width: COL_W,
        sortable: false, filter: false, suppressMovable: true,
        cellRenderer: (params) => params.data?._isGroup
          ? null
          : <VariantCellRenderer value={params.value} data={params.data} />,
        cellStyle: {
          padding: 0, overflow: 'hidden',
          borderRight: '1px solid #f0eeea',
        },
        headerClass: col.type === 'ins' ? 'ag-ins-col-header' : 'ag-pos-header',
      });
    });

    return cols;
  }, [msaColumns, gene, posMode]);

  // ── Row Data ──────────────────────────────────────────────────────────────
  const rowData = useMemo(() => {
    if (!groups?.length || !msaColumns?.length || !gene) return [];

    const rows = [];
    groups.forEach((group, gi) => {
      const color = HAP_COLORS[gi % HAP_COLORS.length];

      // Group-header row
      rows.push({
        _isGroup: true,
        _label: group.label,
        _groupColor: color,
        _groupMeta: `${group.vis.length} · ${group.nSnp||0}snp${group.nGap?` · ${group.nGap}gap`:''}`,
      });

      // Sample rows
      group.vis.forEach(sid => {
        const si = sampleIdxMap?.[sid] ?? sampleList.indexOf(sid);
        const row = {
          _label: sid,
          _groupColor: color,
          _isGroup: false,
          _sid: sid,
        };

        msaColumns.forEach((col, ci) => {
          if (col.type === 'ins') {
            const insSeq = sampleInsMap?.[sid]?.[col.afterPos] || '';
            row[`col_${ci}`] = insSeq[col.insIdx] || null;
            return;
          }
          const pos = col.pos;
          const refBase = gene.seq[pos - 1] || 'N';
          const pd = pdMap.get(pos);
          const allele = getAllele(pd, si, refBase);
          row[`col_${ci}`] = allele; // null = ref (shown as dot)
        });

        rows.push(row);
      });
    });

    return rows;
  }, [groups, msaColumns, gene, pdMap, sampleIdxMap, sampleList, sampleInsMap, getAllele]);

  // ── Grid Options ──────────────────────────────────────────────────────────
  const defaultColDef = useMemo(() => ({
    sortable: false,
    filter: false,
    resizable: false,
    suppressMovable: true,
  }), []);

  const getRowHeight = useCallback((params) => {
    return params.data?._isGroup ? 22 : ROW_H;
  }, []);

  const getRowStyle = useCallback((params) => {
    if (params.data?._isGroup) {
      return { background: (params.data._groupColor || '#888') + '12' };
    }
    return {};
  }, []);

  const onCellMouseOver = useCallback((params) => {
    if (!params.data || params.data._isGroup || !onHover) return;
    const ci = parseInt(params.colDef.field?.replace('col_', ''));
    if (isNaN(ci) || !msaColumns[ci]) return;
    const col = msaColumns[ci];
    const fakeEvent = {
      clientX: params.event?.clientX || 0,
      clientY: params.event?.clientY || 0,
    };
    onHover(fakeEvent, params.data._sid, col);
  }, [msaColumns, onHover]);

  if (!rowData.length || !columnDefs.length) return null;

  return (
    <div
      className="ag-theme-alpine"
      style={{
        width: '100%',
        flex: 1,
        '--ag-font-family': '"JetBrains Mono", monospace',
        '--ag-font-size': '10px',
        '--ag-row-height': `${ROW_H}px`,
        '--ag-header-height': '22px',
        '--ag-cell-horizontal-padding': '0px',
        '--ag-borders': 'none',
        '--ag-row-border-color': '#f0eeea',
        '--ag-header-background-color': '#faf9f6',
        '--ag-background-color': '#fdfcfa',
        '--ag-odd-row-background-color': '#fdfcfa',
        '--ag-selected-row-background-color': '#e0f2fe',
      }}
      onMouseLeave={onLeave}
    >
      <AgGridReact
        ref={gridRef}
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowHeight={getRowHeight}
        getRowStyle={getRowStyle}
        rowBuffer={20}
        suppressRowHoverHighlight={false}
        suppressCellFocus={true}
        onCellMouseOver={onCellMouseOver}
        domLayout="autoHeight"
        headerHeight={22}
        suppressHorizontalScroll={false}
      />
    </div>
  );
}
