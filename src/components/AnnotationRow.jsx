import React from 'react';
import { REGION_COL, REGION_LBL } from '../utils/annotation.js';

export default function AnnotationRow({ gene, annotSegments, colW, padLeft, padRight }) {
  if (!gene || !annotSegments.length) return null;
  const arrow = gene.strand === '+' ? '→' : '←';
  return (
    <tr className="fr-annot-tr">
      <th className="vo-label" style={{ background: '#fafaf8', fontSize: 9, color: '#0d9488', fontWeight: 700, verticalAlign: 'middle' }}>
        Transcription {gene.strand === '+' ? "(5'→3')" : "(3'←5')"}
      </th>
      {padLeft > 0 && <th style={{ width: padLeft, minWidth: padLeft, padding: 0, border: 'none' }} />}
      {annotSegments.map((seg, si) => {
        const span = seg.endIdx - seg.startIdx + 1;
        const w = span * colW;
        // Insertion columns: empty cell with subtle background
        if (seg.type === 'ins') {
          return (
            <th key={si} colSpan={span} className="fr-annot-cell fr-annot-ins" style={{ minWidth: w }} />
          );
        }
        const col = REGION_COL[seg.type] || '#ddd';
        const label = REGION_LBL[seg.type] || '';
        if (seg.type === 'intron') {
          return (
            <th key={si} colSpan={span} className="fr-annot-cell fr-annot-intron" style={{ minWidth: w }}>
              <div className="fr-intron-line">
                {w > 20 && <span className="fr-intron-arrow">{arrow}</span>}
              </div>
            </th>
          );
        }
        if (seg.type === 'upstream' || seg.type === 'downstream') {
          return (
            <th key={si} colSpan={span} className="fr-annot-cell" style={{ minWidth: w, background: `${col}15` }}>
              {w > 40 && <span className="fr-annot-label" style={{ color: '#aaa' }}>{label}</span>}
            </th>
          );
        }
        return (
          <th key={si} colSpan={span} className="fr-annot-cell"
            style={{ background: `${col}20`, borderBottom: `3px solid ${col}`, minWidth: w }}>
            {w > 25 && <span className="fr-annot-label" style={{ color: col }}>{label}</span>}
          </th>
        );
      })}
      {padRight > 0 && <th style={{ width: padRight, minWidth: padRight, padding: 0, border: 'none' }} />}
    </tr>
  );
}
