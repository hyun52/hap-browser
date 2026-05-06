/**
 * positionUtils.js
 * Local ↔ RAP-DB absolute coordinate conversion utilities
 *
 * local: 1-based relative coordinate within the region (existing HapBrowser internal coord)
 * rapdb: RAP-DB absolute coordinate (= local + offset)
 *        offset = gene.region_start (offset field in meta.json)
 */

/** local → RAP-DB */
export function localToRapdb(localPos, offset) {
  return localPos + offset;
}

/** RAP-DB → local */
export function rapdbToLocal(rapdbPos, offset) {
  return rapdbPos - offset;
}

/**
 * Returns a coordinate string for display
 * @param {number} localPos
 * @param {number} offset
 * @param {'rapdb'|'local'} mode
 * @returns {string}
 */
export function formatPos(localPos, offset, mode = 'rapdb') {
  if (mode === 'rapdb') return localToRapdb(localPos, offset).toLocaleString();
  return localPos.toLocaleString();
}

/**
 * Parse coordinates: user input → local coord
 * Accepts commas/spaces. If rapdb coord, subtracts offset.
 * @param {string} input
 * @param {number} offset
 * @param {'rapdb'|'local'} mode - current input mode
 * @returns {number|null}
 */
export function parseUserPos(input, offset, mode = 'rapdb') {
  const n = parseInt(String(input).replace(/[,\s]/g, ''), 10);
  if (isNaN(n)) return null;
  if (mode === 'rapdb') return rapdbToLocal(n, offset);
  return n;
}
