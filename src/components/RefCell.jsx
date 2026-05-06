import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { BASE_COL } from '../utils/constants.js';

export default function RefCell({ pos, base, gene }) {
  const [popup, setPopup] = useState(null);
  const [hovered, setHovered] = useState(false);
  const rapdb = gene ? (pos + gene.offset).toLocaleString() : pos;
  const chr = gene?.chr || '';

  const handleClick = (e) => {
    if (popup) { setPopup(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setPopup({
      x: Math.max(10, Math.min(rect.left + rect.width / 2 - 60, window.innerWidth - 140)),
      y: rect.top - 44,
    });
  };

  return (
    <td className="vo-cell vo-ref-cell"
      style={{
        color: BASE_COL[base], position: 'relative', cursor: 'pointer',
        background: (hovered || popup) ? '#dbeafe' : undefined,
        outline: (hovered || popup) ? '2px solid #2563eb' : 'none',
        outlineOffset: '-2px', transition: 'background .1s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPopup(null); }}
      onClick={handleClick}>
      {base}
      {popup && ReactDOM.createPortal(
        <div className="ref-pos-popup" style={{ left: popup.x, top: popup.y }}>
          <div className="ref-pos-chr">{chr}:{rapdb}</div>
          <div className="ref-pos-local">local:{pos}</div>
        </div>,
        document.body
      )}
    </td>
  );
}
