#!/usr/bin/env python3
"""
merge_pileup.py — Merge individual pileup JSONs into one all.json per gene.
200 files → 1 file = much faster loading (especially on HDD).

Usage:
    python scripts/merge_pileup.py [data_dir]
    python scripts/merge_pileup.py public/data

The browser will automatically use all.json if it exists,
falling back to individual files if not.
"""

import json
import os
import sys
import glob

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else "public/data"
PILEUP_DIR = os.path.join(DATA_DIR, "pileup")

if not os.path.isdir(PILEUP_DIR):
    print(f"Error: {PILEUP_DIR} not found")
    sys.exit(1)

gene_dirs = sorted([d for d in os.listdir(PILEUP_DIR)
                     if os.path.isdir(os.path.join(PILEUP_DIR, d)) and d.startswith("Os")])

print(f"Merging pileup files in: {PILEUP_DIR}")
print(f"Found {len(gene_dirs)} genes\n")

for gene in gene_dirs:
    gene_dir = os.path.join(PILEUP_DIR, gene)
    files = sorted(glob.glob(os.path.join(gene_dir, "*.json")))
    # Exclude all.json itself
    files = [f for f in files if os.path.basename(f) != "all.json"]

    if not files:
        print(f"  SKIP: {gene} (no pileup files)")
        continue

    merged = {}
    for f in files:
        sid = os.path.basename(f).replace(".json", "")
        with open(f) as fh:
            data = json.load(fh)
        # Handle both formats: {"pileup": {...}} and direct pileup dict
        merged[sid] = data.get("pileup", data)

    out_path = os.path.join(gene_dir, "all.json")
    with open(out_path, "w") as out:
        json.dump(merged, out)

    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"  OK: {gene} — {len(files)} samples → all.json ({size_mb:.1f}MB)")

print(f"\nDone! Browser will auto-detect all.json for faster loading.")
