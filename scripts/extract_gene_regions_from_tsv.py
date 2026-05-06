#!/usr/bin/env python3
"""
extract_gene_regions_from_tsv.py
---------------------------------
Reads genes.tsv, calls extract_gene_regions.py, and
moves the results into each gene's group folder automatically.

Usage:
    python scripts/extract_gene_regions_from_tsv.py \\
        --genome IRGSP-1.0_genome.fasta \\
        --locus locus.gff \\
        --transcripts transcripts.gff \\
        --gene-tsv genes.tsv \\
        --upstream 5000 \\
        --downstream 5000 \\
        --data-dir public/data

What it does:
    1) Parse TSV → gene_id, group mapping
    2) Skip genes that are already extracted (idempotent)
    3) Invoke extract_gene_regions.py (output goes to a temporary folder)
    4) Move each gene's output directory into the correct group folder

With this, one Snakefile invocation places all genes in their correct locations.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile


def parse_tsv(path):
    """genes.tsv → [(gene_id, group)] list, preserving order.

    TSV format (tab-separated):
        gene_id <TAB> group [<TAB> symbol [<TAB> description]]
    """
    entries = []
    header_seen = False
    with open(path) as f:
        for ln, line in enumerate(f, 1):
            line = line.rstrip('\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            parts = line.split('\t')
            if not header_seen and parts[0].lower() == 'gene_id':
                header_seen = True
                continue
            header_seen = True
            if len(parts) < 2:
                print(f'  ⚠  line {ln}: need at least 2 columns (gene_id, group)', file=sys.stderr)
                continue
            gene_id = parts[0].strip()
            group   = parts[1].strip()
            if not re.match(r'^Os\d+g\d+$', gene_id):
                print(f'  ⚠  line {ln}: invalid gene_id: {gene_id}', file=sys.stderr)
                continue
            entries.append((gene_id, group))
    return entries


def is_already_extracted(data_dir, group, gene_id):
    """Check whether this gene is already extracted in the target group folder."""
    base = os.path.join(data_dir, group, gene_id)
    required = [
        os.path.join(base, f'{gene_id}.fa'),
        os.path.join(base, f'{gene_id}.local.gff3'),
        os.path.join(base, f'{gene_id}.meta.json'),
    ]
    return all(os.path.exists(p) for p in required)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--genome', required=True)
    p.add_argument('--locus', required=True)
    p.add_argument('--transcripts', required=True)
    p.add_argument('--gene-tsv', required=True)
    p.add_argument('--upstream', type=int, default=5000)
    p.add_argument('--downstream', type=int, default=5000)
    p.add_argument('--data-dir', default='public/data')
    p.add_argument('--force', action='store_true',
                   help='Re-extract even if already present')
    p.add_argument('--extract-script',
                   default=os.path.join(os.path.dirname(__file__), 'extract_gene_regions.py'),
                   help='Path to extract_gene_regions.py')
    args = p.parse_args()

    if not os.path.exists(args.extract_script):
        print(f'ERROR: extract_gene_regions.py not found at {args.extract_script}',
              file=sys.stderr)
        return 1

    entries = parse_tsv(args.gene_tsv)
    print(f'[INFO] {len(entries)} genes in {args.gene_tsv}')

    # Split into already-extracted and to-extract
    to_extract = []
    skipped = []
    for gene_id, group in entries:
        if not args.force and is_already_extracted(args.data_dir, group, gene_id):
            skipped.append((gene_id, group))
        else:
            to_extract.append((gene_id, group))

    if skipped:
        print(f'[INFO] Skipping {len(skipped)} already-extracted genes')
    if not to_extract:
        print('[INFO] Nothing to extract. Done.')
        return 0

    print(f'[INFO] Extracting {len(to_extract)} genes...')

    # Write temporary gene_list.txt
    with tempfile.TemporaryDirectory() as tmpdir:
        gene_list_path = os.path.join(tmpdir, 'gene_list.txt')
        with open(gene_list_path, 'w') as f:
            for gene_id, _ in to_extract:
                f.write(gene_id + '\n')

        out_tmp = os.path.join(tmpdir, 'output')

        cmd = [
            sys.executable, args.extract_script,
            '--genome', args.genome,
            '--locus', args.locus,
            '--transcripts', args.transcripts,
            '--gene-list', gene_list_path,
            '--upstream', str(args.upstream),
            '--downstream', str(args.downstream),
            '--outdir', out_tmp,
        ]
        print('[RUN]', ' '.join(cmd))
        r = subprocess.run(cmd)
        if r.returncode != 0:
            print('ERROR: extract_gene_regions.py failed', file=sys.stderr)
            return r.returncode

        # Move each gene directory into the correct group folder
        moved = 0
        for gene_id, group in to_extract:
            src = os.path.join(out_tmp, gene_id)
            if not os.path.isdir(src):
                print(f'  ⚠  {gene_id}: output dir missing, skipping move', file=sys.stderr)
                continue

            dst_group = os.path.join(args.data_dir, group)
            os.makedirs(dst_group, exist_ok=True)
            dst = os.path.join(dst_group, gene_id)

            if os.path.exists(dst):
                # If empty, remove and proceed (Snakemake may have pre-created an empty folder)
                if not os.listdir(dst):
                    os.rmdir(dst)
                elif args.force:
                    shutil.rmtree(dst)
                else:
                    print(f'  ⚠  {gene_id}: {dst} exists (non-empty), skip move')
                    continue

            shutil.move(src, dst)
            print(f'  ✓  {gene_id} → {group}/')
            moved += 1

    print(f'[DONE] Moved {moved} gene directories into {args.data_dir}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
