#!/usr/bin/env python3
"""
generate_index.py
-----------------
Scans subdirectories of data/ and generates index.json.

Gene symbols and group order are read from genes.tsv.
   - genes.tsv: gene_id \\t symbol \\t group \\t description (tab-separated)
   - Location: project root (hap-browser/genes.tsv)

Usage:
    python scripts/generate_index.py
    python scripts/generate_index.py --data-dir public/data
    python scripts/generate_index.py --gene-tsv custom.tsv

Run from: project root (hap-browser/)

Example data/ structure:
    data/
      Heading date genes/
        Os06g0275000/
          Os06g0275000.fa
          Os06g0275000.local.gff3
          Os06g0275000.meta.json
      Yield components/
        Os07g0281400/
          ...

Output: data/index.json
"""

import argparse
import json
import os
import re
import sys
import urllib.parse


def load_gene_registry(tsv_path):
    """
    Reads genes.tsv and returns {gene_id: {symbol, group, description}} dict.

    TSV format (tab-separated):
      Required 2 columns:  gene_id <TAB> group
      Optional 3 columns:  gene_id <TAB> group <TAB> symbol       (symbol override)
      Optional 4 columns:  gene_id <TAB> group <TAB> symbol <TAB> description

    If symbol/description are empty, auto-extracted from GFF.
    Comment lines (#) and blank lines are ignored.
    """
    if not os.path.exists(tsv_path):
        print(f'⚠  gene registry not found: {tsv_path}')
        print(f'   Gene symbols will default to gene_id.')
        print(f'   Create {tsv_path} with columns: gene_id<TAB>group[<TAB>symbol[<TAB>description]]')
        return {}, []

    registry = {}
    group_order = []   # collect groups in order of appearance
    group_seen = set()

    with open(tsv_path) as f:
        header_seen = False
        for ln, line in enumerate(f, 1):
            line = line.rstrip('\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue

            parts = line.split('\t')
            # skip first line if it is a header
            if not header_seen and parts[0].lower() == 'gene_id':
                header_seen = True
                continue
            header_seen = True

            if len(parts) < 2:
                print(f'  ⚠  genes.tsv line {ln}: need at least 2 columns (gene_id, group)')
                continue

            gene_id = parts[0].strip()
            group   = parts[1].strip()
            symbol  = parts[2].strip() if len(parts) >= 3 else ''
            desc    = parts[3].strip() if len(parts) >= 4 else ''

            if not re.match(r'^Os\d+g\d+$', gene_id):
                print(f'  ⚠  genes.tsv line {ln}: invalid gene_id format: {gene_id}')
                continue

            registry[gene_id] = {'sym': symbol, 'group': group, 'desc': desc}

            if group not in group_seen:
                group_seen.add(group)
                group_order.append(group)

    print(f'[INFO] Loaded {len(registry)} genes across {len(group_order)} groups from {tsv_path}')
    return registry, group_order


def find_data_dir():
    """Auto-detect data/ folder: prefer public/data over data."""
    cwd = os.getcwd()
    candidates = [
        os.path.join(cwd, 'public', 'data'),
        os.path.join(cwd, 'data'),
        os.path.join(cwd, '..', 'public', 'data'),
    ]
    for c in candidates:
        if os.path.isdir(c):
            return os.path.abspath(c)
    return None


def find_registry():
    """Auto-detect genes.tsv file."""
    cwd = os.getcwd()
    candidates = [
        os.path.join(cwd, 'genes.tsv'),
        os.path.join(cwd, '..', 'genes.tsv'),
        os.path.join(cwd, 'scripts', 'genes.tsv'),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return os.path.abspath(c)
    return os.path.join(cwd, 'genes.tsv')  # default path even if missing


def parse_meta(path):
    with open(path) as f:
        return json.load(f)


def get_gene_info_from_gff(gff_path, gene_id):
    """Extract (symbol, description) for target gene from GFF3 file.

    RAP-DB Note format example:
        Note=SE14%2CHd1 %28nss1%29%2CHeading date 1%2C...
    → after URL decode and comma split:
        ['SE14', 'Hd1 (nss1)', 'Heading date 1', ...]
    → symbol = first token (short, identifier-like), description = longest remaining token

    Returns: (symbol, description) — ('', '') if not found
    """
    try:
        with open(gff_path) as f:
            for line in f:
                if line.startswith('#'):
                    continue
                parts = line.strip().split('\t')
                if len(parts) < 9 or parts[2] != 'gene':
                    continue
                attrs = dict(
                    kv.split('=', 1) for kv in parts[8].split(';') if '=' in kv
                )
                if attrs.get('ID', '') == gene_id:
                    note = urllib.parse.unquote(attrs.get('Note', ''))
                    tokens = [t.strip() for t in note.split(',') if t.strip()]
                    if not tokens:
                        return '', ''
                    # if first token is short (<=15 chars) and looks like a symbol, use it
                    symbol = tokens[0] if len(tokens[0]) <= 15 else ''
                    # description = longest token (usually full name)
                    desc = max(tokens, key=len) if tokens else ''
                    return symbol, desc
    except Exception:
        pass
    return '', ''


def get_gene_desc_from_gff(gff_path, gene_id):
    """Backward-compatible wrapper — returns description only."""
    _, desc = get_gene_info_from_gff(gff_path, gene_id)
    return desc


def find_gene_files(group_dir, gene_id):
    """Find and return paths for the 3 gene files. Supports both flat and sub structures."""
    flat = {
        'meta': os.path.join(group_dir, f'{gene_id}.meta.json'),
        'gff':  os.path.join(group_dir, f'{gene_id}.local.gff3'),
        'fa':   os.path.join(group_dir, f'{gene_id}.fa'),
    }
    if all(os.path.exists(p) for p in flat.values()):
        return flat

    sub_dir = os.path.join(group_dir, gene_id)
    sub = {
        'meta': os.path.join(sub_dir, f'{gene_id}.meta.json'),
        'gff':  os.path.join(sub_dir, f'{gene_id}.local.gff3'),
        'fa':   os.path.join(sub_dir, f'{gene_id}.fa'),
    }
    if os.path.isdir(sub_dir) and all(os.path.exists(p) for p in sub.values()):
        return sub

    return None


def scan_group(group_dir, group_name, data_dir, registry):
    """Scan one group directory and return the list of genes."""
    genes = []

    candidates = set()
    for entry in os.listdir(group_dir):
        if entry.endswith('.meta.json'):
            candidates.add(entry.replace('.meta.json', ''))
        elif os.path.isdir(os.path.join(group_dir, entry)) and re.match(r'^Os\d+g\d+', entry):
            candidates.add(entry)

    for gene_id in sorted(candidates):
        paths = find_gene_files(group_dir, gene_id)
        if paths is None:
            print(f'  ⚠  {gene_id}: missing one of .fa / .local.gff3 / .meta.json')
            continue

        meta = parse_meta(paths['meta'])

        # Auto-extract symbol and description from GFF
        gff_sym, gff_desc = get_gene_info_from_gff(paths['gff'], gene_id)

        # Registry first; fall back to GFF auto-extract; finally fall back to gene_id
        reg = registry.get(gene_id, {})
        sym  = (reg.get('sym') or gff_sym or gene_id)
        desc = (reg.get('desc') or gff_desc)

        if os.path.dirname(paths['fa']) == group_dir:
            fa_rel  = f'data/{group_name}/{gene_id}.fa'
            gff_rel = f'data/{group_name}/{gene_id}.local.gff3'
        else:
            fa_rel  = f'data/{group_name}/{gene_id}/{gene_id}.fa'
            gff_rel = f'data/{group_name}/{gene_id}/{gene_id}.local.gff3'

        genes.append({
            'id':      gene_id,
            'sym':     sym,
            'desc':    desc,
            'chr':     meta.get('chromosome', ''),
            'strand':  meta.get('strand', '+'),
            'gene_start':    meta.get('gene_start', 0),
            'gene_end':      meta.get('gene_end', 0),
            'region_start':  meta.get('region_start', 0),
            'region_end':    meta.get('region_end', 0),
            'region_length': meta.get('region_length', 0),
            'offset':        meta.get('offset', 0),
            'fa':   fa_rel,
            'gff':  gff_rel,
            'meta': fa_rel.replace('.fa', '.meta.json'),
        })
        struct = 'flat' if os.path.dirname(paths['fa']) == group_dir else 'sub'
        print(f'  ✓  {gene_id}  ({sym})  [{struct}]')

        # Auto-generate samples.json if BAM folder exists
        bam_dir = os.path.join(data_dir, 'bam', gene_id)
        if os.path.isdir(bam_dir):
            samples = sorted(
                f.replace('.bam', '')
                for f in os.listdir(bam_dir)
                if f.endswith('.bam') and not f.endswith('.bai') and 'tmp' not in f
            )
            if samples:
                samples_path = os.path.join(bam_dir, 'samples.json')
                with open(samples_path, 'w') as sf:
                    json.dump(samples, sf)
                print(f'       samples.json: {len(samples)} samples')

    # Sort by registry order (TSV row order = sidebar order)
    reg_order = [gid for gid in registry if registry[gid].get('group') == group_name]
    order_idx = {gid: i for i, gid in enumerate(reg_order)}
    genes.sort(key=lambda g: (
        order_idx.get(g['id'], len(reg_order)),
        g['id']
    ))
    return genes


def main():
    parser = argparse.ArgumentParser(description='Generate index.json for HapBrowser')
    parser.add_argument('--data-dir', help='Data directory path (auto-detected if not specified)')
    parser.add_argument('--gene-tsv', help='Path to genes.tsv registry (default: ./genes.tsv)')
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir) if args.data_dir else find_data_dir()
    tsv_path = os.path.abspath(args.gene_tsv) if args.gene_tsv else find_registry()

    if not data_dir or not os.path.isdir(data_dir):
        print(f'ERROR: data/ folder not found.')
        print(f'  Attempted path: {data_dir}')
        return 1

    print(f'Data directory: {data_dir}')
    print(f'Gene registry:  {tsv_path}')
    print()

    registry, group_order = load_gene_registry(tsv_path)

    index = {'groups': []}

    SKIP_DIRS = {'bam', 'pileup', 'variants', 'haplotypes', 'blast_db',
                 'precomputed', '.DS_Store'}

    # 1) Group order from registry takes priority
    found_groups = {
        d for d in os.listdir(data_dir)
        if os.path.isdir(os.path.join(data_dir, d))
        and not d.startswith('.')
        and d not in SKIP_DIRS
    }

    ordered_groups = [g for g in group_order if g in found_groups]
    # 2) Append any folder-only groups (not in registry) at the end
    unregistered = sorted(found_groups - set(group_order))
    ordered_groups.extend(unregistered)

    if not ordered_groups:
        print('No gene group folders under data/.')
        return 1

    for group_name in ordered_groups:
        group_path = os.path.join(data_dir, group_name)
        print(f'\n📂  {group_name}')
        genes = scan_group(group_path, group_name, data_dir, registry)
        if genes:
            index['groups'].append({'name': group_name, 'genes': genes})
            print(f'   → {len(genes)} genes registered')

    out_path = os.path.join(data_dir, 'index.json')
    with open(out_path, 'w') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    total = sum(len(g['genes']) for g in index['groups'])
    print(f'\n✅  data/index.json created ({len(index["groups"])} groups, {total} genes)')
    print(f'   Saved to: {out_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
