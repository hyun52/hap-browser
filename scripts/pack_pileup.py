#!/usr/bin/env python3
"""
pack_pileup.py — Convert all.json into a compact binary form for the browser.

The merged per-gene JSON holds one small object per sample and position, which
for a 200-accession panel over a 12 kb locus is some two million objects. The
transfer cost of that file is largely solved by serving it gzipped, but the
browser must still parse it and allocate those objects, which dominates the
time to open a gene and cannot be reduced while the format stays JSON.

The counts themselves are six or eight small integers per cell, so they are
written here as a dense array of unsigned 16-bit values, which the browser maps
directly onto an ArrayBuffer with no parsing at all. Inserted sequences are
strings and remain in a sidecar JSON, where they are sparse enough not to
matter.

    all.bin       header, then nSamples x length x 8 uint16, sample-major
    all_meta.json sample order, locus length, and inserted sequences

Channels per cell, in order: A, T, G, C, del, ins, xpp, xbq.
Absent positions are written as zeros, which the browser treats as no coverage,
exactly as it treats a missing key in the JSON form.

Usage:
    python scripts/pack_pileup.py [data_dir]
    python scripts/pack_pileup.py public/data --gene Os03g0129400
"""

import argparse
import gzip
import json
import os
import struct
import sys
from pathlib import Path

MAGIC = b'HAPB'
VERSION = 1
CHANNELS = ('A', 'T', 'G', 'C', 'del', 'ins', 'xpp', 'xbq')
NCH = len(CHANNELS)
UINT16_MAX = 65535

try:
    import numpy as np
except ImportError:
    np = None


def pack_gene(gene_dir, force=False):
    gene = os.path.basename(gene_dir)
    src = os.path.join(gene_dir, 'all.json')
    if not os.path.exists(src):
        return f"  - {gene}: no all.json"

    bin_path = os.path.join(gene_dir, 'all.bin')
    meta_path = os.path.join(gene_dir, 'all_meta.json')
    if not force and os.path.exists(bin_path) and os.path.getmtime(bin_path) > os.path.getmtime(src):
        return f"  · {gene} (up to date)"

    with open(src) as fh:
        merged = json.load(fh)

    samples = sorted(merged)
    if not samples:
        return f"  - {gene}: empty"

    # The locus length is taken from the largest position seen rather than from
    # the metadata file, so that this script depends only on all.json.
    length = 0
    for sid in samples:
        pu = merged[sid]
        if pu:
            length = max(length, max(int(p) for p in pu))
    if length == 0:
        return f"  - {gene}: no positions"

    n = len(samples)
    if np is not None:
        arr = np.zeros(n * length * NCH, dtype='<u2')
    else:
        import array as _array
        arr = _array.array('H', bytes(n * length * NCH * 2))

    ins_seqs = {}
    clipped = 0
    for si, sid in enumerate(samples):
        base = si * length * NCH
        pu = merged[sid] or {}
        seq_here = {}
        for pos_s, v in pu.items():
            off = base + (int(pos_s) - 1) * NCH
            for ci, key in enumerate(CHANNELS):
                val = v.get(key, 0)
                if val > UINT16_MAX:
                    val = UINT16_MAX
                    clipped += 1
                arr[off + ci] = val
            s = v.get('ins_seqs')
            if s:
                seq_here[pos_s] = s
        if seq_here:
            ins_seqs[sid] = seq_here

    header = MAGIC + struct.pack('<III', VERSION, n, length)
    payload = arr.tobytes() if np is not None else arr.tobytes()
    with open(bin_path, 'wb') as out:
        out.write(header)
        out.write(payload)
    with gzip.open(bin_path + '.gz', 'wb', compresslevel=6) as out:
        out.write(header)
        out.write(payload)

    meta = {
        'gene_id': gene,
        'samples': samples,
        'length': length,
        'channels': list(CHANNELS),
        'ins_seqs': ins_seqs,
    }
    with open(meta_path, 'w') as out:
        json.dump(meta, out, separators=(',', ':'))
    with gzip.open(meta_path + '.gz', 'wt', compresslevel=6) as out:
        json.dump(meta, out, separators=(',', ':'))

    src_mb = os.path.getsize(src) / 1024 / 1024
    bin_mb = os.path.getsize(bin_path) / 1024 / 1024
    gz_mb = os.path.getsize(bin_path + '.gz') / 1024 / 1024
    note = f", {clipped} counts clipped at {UINT16_MAX}" if clipped else ""
    return (f"  OK: {gene} — {n} samples x {length} bp — "
            f"{src_mb:.0f}MB json -> {bin_mb:.0f}MB bin ({gz_mb:.0f}MB gz){note}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('data_dir', nargs='?', default='public/data')
    ap.add_argument('--gene', help='Pack a single gene only')
    ap.add_argument('--force', action='store_true', help='Repack even if up to date')
    args = ap.parse_args()

    pileup_root = Path(args.data_dir) / 'pileup'
    if not pileup_root.exists():
        print(f"No pileup directory at {pileup_root}", file=sys.stderr)
        return 1

    if np is None:
        print("  (numpy not found; using the array module, which is slower)")

    dirs = ([pileup_root / args.gene] if args.gene
            else sorted(d for d in pileup_root.iterdir() if d.is_dir()))
    print(f"Packing {len(dirs)} gene(s) from {pileup_root}\n")
    for d in dirs:
        print(pack_gene(str(d), force=args.force), flush=True)
    print("\nDone.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
