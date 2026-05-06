#!/usr/bin/env python3
"""
precompute.py
-------------
Reads per-gene pileup + reference sequence + GFF3 and produces precomputed.json.

Pre-computes on the server what would otherwise be downloaded and computed in the browser.

Output: data/precomputed/{GENE_ID}.json

Usage:
    python scripts/precompute.py
    python scripts/precompute.py --data-dir public/data
    python scripts/precompute.py --gene Os06g0275000
    python scripts/precompute.py --jobs 8   # number of parallel workers

Output schema:
    {
      "gene_id": str,
      "region_length": int,
      "offset": int,            # region_start (for converting to RAP-DB absolute coords)
      "gene_start": int,        # RAP-DB absolute coordinate
      "gene_end": int,
      "strand": "+"|"-",
      "samples": [str, ...],
      "combos": {               # 14 haplotype combinations
        "gene_110": { haplotypes: [...], variantPositions: [...] },
        ...
      },
      "positionData": [         # per-variant allele data (compressed)
        {
          "pos": int,
          "ref": str,
          "alleles": { sampleId: allele, ... },  # only non-ref
          "hasSnp": bool,
          "hasDel": bool,
          "hasNoCov": bool,
          "hasIns": bool,
          "inGene": bool,
          "inCds": bool,
          "aaChange": null | {   # CDS positions only
            "codon_pos": int,    # 0-based codon position within CDS
            "ref_codon": str,
            "ref_aa": str,
            "alts": {            # allele → { alt_codon, alt_aa, type }
              "A": { "codon": "GCC", "aa": "Ala", "type": "synonymous"|"nonsynonymous"|"stop" }
            },
            "frameshift": false  # whether InDel causes frameshift
          }
        }
      ],
      "msaInsData": {           # for insertion columns
        "pos_str": { sampleId: insSeq, ... }
      }
    }
"""

import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed

# ─── Codon table ───────────────────────────────────────────────────────────────
CODON_TABLE = {
    'TTT': 'Phe', 'TTC': 'Phe', 'TTA': 'Leu', 'TTG': 'Leu',
    'CTT': 'Leu', 'CTC': 'Leu', 'CTA': 'Leu', 'CTG': 'Leu',
    'ATT': 'Ile', 'ATC': 'Ile', 'ATA': 'Ile', 'ATG': 'Met',
    'GTT': 'Val', 'GTC': 'Val', 'GTA': 'Val', 'GTG': 'Val',
    'TCT': 'Ser', 'TCC': 'Ser', 'TCA': 'Ser', 'TCG': 'Ser',
    'CCT': 'Pro', 'CCC': 'Pro', 'CCA': 'Pro', 'CCG': 'Pro',
    'ACT': 'Thr', 'ACC': 'Thr', 'ACA': 'Thr', 'ACG': 'Thr',
    'GCT': 'Ala', 'GCC': 'Ala', 'GCA': 'Ala', 'GCG': 'Ala',
    'TAT': 'Tyr', 'TAC': 'Tyr', 'TAA': 'Stop', 'TAG': 'Stop',
    'CAT': 'His', 'CAC': 'His', 'CAA': 'Gln', 'CAG': 'Gln',
    'AAT': 'Asn', 'AAC': 'Asn', 'AAA': 'Lys', 'AAG': 'Lys',
    'GAT': 'Asp', 'GAC': 'Asp', 'GAA': 'Glu', 'GAG': 'Glu',
    'TGT': 'Cys', 'TGC': 'Cys', 'TGA': 'Stop', 'TGG': 'Trp',
    'CGT': 'Arg', 'CGC': 'Arg', 'CGA': 'Arg', 'CGG': 'Arg',
    'AGT': 'Ser', 'AGC': 'Ser', 'AGA': 'Arg', 'AGG': 'Arg',
    'GGT': 'Gly', 'GGC': 'Gly', 'GGA': 'Gly', 'GGG': 'Gly',
}

RC_MAP = str.maketrans('ATGCN', 'TACGN')

def reverse_complement(seq):
    return seq.translate(RC_MAP)[::-1]

def translate_codon(codon):
    return CODON_TABLE.get(codon.upper(), '?')


# ─── File parsers ───────────────────────────────────────────────────────────────
def parse_fasta(path):
    seq_parts = []
    with open(path) as f:
        for line in f:
            if line.startswith('>'):
                continue
            seq_parts.append(line.strip().upper())
    return ''.join(seq_parts)


def parse_gff3(path):
    features = []
    with open(path) as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            parts = line.strip().split('\t')
            if len(parts) < 9:
                continue
            feat_type = parts[2]
            start, end = int(parts[3]), int(parts[4])
            strand = parts[6]
            attrs = {}
            for kv in parts[8].split(';'):
                if '=' in kv:
                    k, v = kv.split('=', 1)
                    attrs[k.strip()] = v.strip()
            features.append({
                'type': feat_type,
                'start': start, 'end': end,
                'strand': strand, 'attrs': attrs
            })
    return features


# ─── CDS coordinate builder ───────────────────────────────────────────────────
def build_cds_info(features, gene_id, ref_seq, offset, strand):
    """
    Build CDS position → (cds_pos_0based, ref_codon, codon_index) mapping.
    Uses local coordinates (1-based, offset-relative).

    Returns:
        cds_local_set: set of local positions that are CDS
        cds_seq_map: local_pos → 0-based index in concatenated CDS sequence
        cds_concat: concatenated CDS sequence (strand-corrected)
        cds_exon_ranges: [(start_local, end_local), ...] sorted by genomic order
    """
    # Find target mRNA ID
    target_mrna_ids = set()
    for f in features:
        if f['type'] == 'mRNA' and f['attrs'].get('Locus_id') == gene_id:
            target_mrna_ids.add(f['attrs'].get('ID', ''))

    # Collect CDS exon ranges (local coords)
    cds_ranges = []
    for f in features:
        if f['type'] in ('CDS', 'exon'):
            parent = f['attrs'].get('Parent', '')
            if parent in target_mrna_ids:
                # GFF3 coords are already local (1-based, offset-relative)
                s_local = f['start']
                e_local = f['end']
                cds_ranges.append((s_local, e_local))

    if not cds_ranges:
        return set(), {}, '', []

    # Sort (genomic order)
    cds_ranges.sort(key=lambda x: x[0])

    # Extract and concatenate CDS sequence (local 1-based → 0-based index)
    cds_local_set = set()
    cds_seq_map = {}  # local_pos → cds_concat index (0-based)
    cds_parts = []
    cds_idx = 0

    for (s, e) in cds_ranges:
        for pos in range(s, e + 1):
            cds_local_set.add(pos)
            cds_seq_map[pos] = cds_idx
            base = ref_seq[pos - 1] if 1 <= pos <= len(ref_seq) else 'N'
            cds_parts.append(base)
            cds_idx += 1

    cds_concat = ''.join(cds_parts)

    # Reverse complement if minus strand
    if strand == '-':
        cds_concat = reverse_complement(cds_concat)
        # Also invert cds_seq_map
        total = len(cds_concat)
        cds_seq_map = {pos: (total - 1 - idx) for pos, idx in cds_seq_map.items()}

    return cds_local_set, cds_seq_map, cds_concat, cds_ranges


def get_aa_change(pos, ref_base, alt_allele, cds_seq_map, cds_concat, strand):
    """
    Computes amino acid change for an SNP at a CDS position.
    alt_allele: 'A'|'T'|'G'|'C'|'D'(del)
    Returns dict or None
    """
    if pos not in cds_seq_map:
        return None

    cds_idx = cds_seq_map[pos]
    codon_idx = cds_idx // 3          # codon index (0-based)
    codon_pos = cds_idx % 3           # position within codon (0-based)
    codon_start = codon_idx * 3

    if codon_start + 2 >= len(cds_concat):
        return None

    ref_codon = cds_concat[codon_start:codon_start + 3]
    ref_aa = translate_codon(ref_codon)

    # InDel: determine frameshift
    if alt_allele in ('D', '-'):
        return {
            'codon_pos': codon_pos,
            'ref_codon': ref_codon,
            'ref_aa': ref_aa,
            'alts': {},
            'frameshift': True,
            'indel_type': 'deletion'
        }

    # SNP: apply alt_allele
    # Complement if minus strand
    if strand == '-':
        comp = str.maketrans('ATGC', 'TACG')
        eff_alt = alt_allele.translate(comp)
    else:
        eff_alt = alt_allele

    alt_codon = ref_codon[:codon_pos] + eff_alt + ref_codon[codon_pos + 1:]
    alt_aa = translate_codon(alt_codon)

    if alt_aa == ref_aa:
        change_type = 'synonymous'
    elif alt_aa == 'Stop':
        change_type = 'stop_gained'
    elif ref_aa == 'Stop':
        change_type = 'stop_lost'
    else:
        change_type = 'nonsynonymous'

    return {
        'codon_pos': codon_pos,
        'ref_codon': ref_codon,
        'ref_aa': ref_aa,
        'alts': {
            alt_allele: {
                'codon': alt_codon,
                'aa': alt_aa,
                'type': change_type
            }
        },
        'frameshift': False
    }


# ─── Haplotype computation ─────────────────────────────────────────────────────
MIN_DEPTH = 5

def get_dominant_allele(p, ref):
    """Return dominant allele from pileup dictionary."""
    if p is None:
        return '-'
    tot = p.get('A', 0) + p.get('T', 0) + p.get('G', 0) + p.get('C', 0) + p.get('del', 0) + p.get('ins', 0)
    if tot == 0:
        return '-'
    if tot < MIN_DEPTH:
        bases = {b: p.get(b, 0) for b in 'ATGC'}
        return max(bases, key=bases.get)
    if p.get('del', 0) > tot * 0.3:
        return 'D'
    bases = {b: p.get(b, 0) for b in 'ATGC'}
    dom = max(bases, key=bases.get)
    # insertion
    if p.get('ins', 0) > 0 and p.get('ins_seqs'):
        ins_entries = sorted(p['ins_seqs'].items(), key=lambda x: -x[1])
        if ins_entries and ins_entries[0][1] >= 2:
            return dom + '+' + ins_entries[0][0]
    return dom


def build_position_data(ref_seq, region_length, sample_ids, pileup_cache,
                        gene_local_start, gene_local_end,
                        cds_local_set, cds_seq_map, cds_concat, strand):
    """Generate positionData array + msaInsData.

    Compressed schema (v83.1):
      alleles dict removed → replaced by enc string
      enc: one character per sample, in sample order
        '0' = ref
        '1'..'9' = 1-based index into altAlleles array
        '-' = no coverage
      altAlleles: unique alt alleles (excluding ref)
      → no repeated sample names: 200 samples × 1 char = 200 B/position
    """
    position_data = []
    msa_ins_data = {}  # str(pos) → {sid: insSeq}
    n_samples = len(sample_ids)

    for pos in range(1, region_length + 1):
        ref = ref_seq[pos - 1] if pos <= len(ref_seq) else 'N'
        if not ref or ref == 'N':
            continue

        has_snp = has_del = has_no_cov = has_ins = False
        raw_alleles = ['0'] * n_samples  # default '0' = ref

        for i, sid in enumerate(sample_ids):
            pileup = pileup_cache.get(sid)
            p = pileup.get(str(pos)) if pileup else None

            if p is None:
                raw_alleles[i] = '-'
                has_no_cov = True
                continue

            tot = (p.get('A', 0) + p.get('T', 0) + p.get('G', 0) +
                   p.get('C', 0) + p.get('del', 0) + p.get('ins', 0))
            if tot == 0:
                raw_alleles[i] = '-'
                has_no_cov = True
                continue

            if tot < MIN_DEPTH:
                bases = {b: p.get(b, 0) for b in 'ATGC'}
                dom = max(bases, key=bases.get)
                raw_alleles[i] = dom if dom != ref else '0'
                continue

            if p.get('del', 0) > tot * 0.3:
                raw_alleles[i] = 'D'
                has_del = True
                continue

            bases = {b: p.get(b, 0) for b in 'ATGC'}
            dom = max(bases, key=bases.get)
            allele = dom

            if p.get('ins_seqs') and p.get('ins', 0) > 0:
                ins_entries = sorted(p['ins_seqs'].items(), key=lambda x: -x[1])
                if ins_entries and ins_entries[0][1] >= 2:
                    ins_seq = ins_entries[0][0]
                    allele = dom + '+' + ins_seq
                    has_ins = True
                    pos_key = str(pos)
                    if pos_key not in msa_ins_data:
                        msa_ins_data[pos_key] = {}
                    msa_ins_data[pos_key][sid] = ins_seq

            raw_alleles[i] = allele if allele != ref else '0'
            if dom != ref and bases[dom] >= MIN_DEPTH:
                has_snp = True

        if not (has_snp or has_del or has_no_cov or has_ins):
            continue

        in_gene = gene_local_start <= pos <= gene_local_end
        in_cds = pos in cds_local_set

        # Collect altAlleles list (excluding ref and '0', preserving order)
        seen = {}
        for a in raw_alleles:
            if a != '0' and a != '-' and a != ref and a not in seen:
                seen[a] = len(seen) + 1  # 1-based index
        alt_alleles = list(seen.keys())

        # Build enc string
        enc_chars = []
        for a in raw_alleles:
            if a == '0' or a == ref:
                enc_chars.append('0')
            elif a == '-':
                enc_chars.append('-')
            else:
                idx = seen.get(a)
                enc_chars.append(str(idx) if idx and idx <= 9 else '1')
        enc = ''.join(enc_chars)

        pd = {
            'pos': pos,
            'ref': ref,
            'alt': alt_alleles,   # e.g., ['G'], ['D'], ['A','G']
            'enc': enc,           # '0001-020100...' 200 chars
            'f': (                # flags bitfield (packed into 1 byte)
                (1 if has_snp else 0) |
                (2 if has_del else 0) |
                (4 if has_no_cov else 0) |
                (8 if has_ins else 0) |
                (16 if in_gene else 0) |
                (32 if in_cds else 0)
            ),
        }

        # Compute AA change (CDS SNP/InDel)
        if in_cds and cds_seq_map:
            alt_counts = {}
            for a in raw_alleles:
                if a not in ('0', '-', ref):
                    base_a = a.split('+')[0] if '+' in a else a
                    alt_counts[base_a] = alt_counts.get(base_a, 0) + 1

            aa_change_map = {}
            for alt_allele in alt_counts:
                r = get_aa_change(pos, ref, alt_allele, cds_seq_map, cds_concat, strand)
                if r:
                    aa_change_map[alt_allele] = r
            if has_del:
                r = get_aa_change(pos, ref, 'D', cds_seq_map, cds_concat, strand)
                if r:
                    aa_change_map['D'] = r

            if aa_change_map:
                first = list(aa_change_map.values())[0]
                merged_alts = {}
                for alt_allele, r in aa_change_map.items():
                    if not r.get('frameshift'):
                        for k, v in r.get('alts', {}).items():
                            merged_alts[k] = v
                pd['aaChange'] = {
                    'codon_pos': first['codon_pos'],
                    'ref_codon': first.get('ref_codon', ''),
                    'ref_aa': first.get('ref_aa', ''),
                    'alts': merged_alts,
                    'frameshift': any(r.get('frameshift', False) for r in aa_change_map.values()),
                    'indel_type': first.get('indel_type', None),
                }

        position_data.append(pd)

    return position_data, msa_ins_data


def hamming(a, b):
    return sum(1 for x, y in zip(a, b) if x != y)


def get_allele_for_sample(pd, sample_idx, ref_base):
    """Return allele by sample index in enc schema."""
    if pd is None:
        return ref_base
    enc = pd.get('enc', '')
    if sample_idx >= len(enc):
        return ref_base
    c = enc[sample_idx]
    if c == '0':
        return ref_base
    if c == '-':
        return '-'
    idx = int(c) - 1  # 0-based
    alts = pd.get('alt', [])
    if idx < len(alts):
        return alts[idx]
    return ref_base


def build_haplotypes(classify_positions, ref_seq, sample_ids, allele_map, flags):
    if not classify_positions:
        return [{
            'id': 'Hap1', 'label': 'Haplotype 1',
            'samples': list(sample_ids), 'pattern': '',
            'nSnp': 0, 'nGap': 0, 'nIns': 0, 'nVariants': 0,
            'nSamples': len(sample_ids),
        }]

    ref_pattern = ''.join(ref_seq[p - 1] for p in classify_positions)
    pattern_map = {}
    sid_to_idx = {sid: i for i, sid in enumerate(sample_ids)}

    for si, sid in enumerate(sample_ids):
        raw_parts = []
        for p in classify_positions:
            pd = allele_map.get(p)
            raw_parts.append(get_allele_for_sample(pd, si, ref_seq[p - 1]))

        classify_parts = []
        for i, a in enumerate(raw_parts):
            rp = ref_pattern[i]
            if a == '-' and not flags['gap']:
                classify_parts.append(rp)
            elif a == 'D' and not flags['indel']:
                classify_parts.append(rp)
            elif '+' in a and not flags['indel']:
                classify_parts.append(a.split('+')[0])
            elif a not in ('-', 'D') and '+' not in a and a != rp and not flags['snp']:
                classify_parts.append(rp)
            else:
                classify_parts.append(a)

        cp = ''.join(classify_parts)
        if cp not in pattern_map:
            pattern_map[cp] = []
        pattern_map[cp].append(sid)

    entries = sorted(pattern_map.items(),
                     key=lambda x: (hamming(x[0], ref_pattern), -len(x[1])))

    result = []
    for i, (pat, samples) in enumerate(entries):
        n_snp = n_gap = n_ins = 0
        sid0 = samples[0]
        si0 = sid_to_idx[sid0]
        for j, p in enumerate(classify_positions):
            pd = allele_map.get(p)
            al = get_allele_for_sample(pd, si0, ref_seq[p - 1])
            rp = ref_pattern[j]
            if al == '-' and not flags['gap']:
                al = rp
            elif al == 'D' and not flags['indel']:
                al = rp
            elif '+' in al and not flags['indel']:
                al = al.split('+')[0]
            elif al not in ('-', 'D') and '+' not in al and al != rp and not flags['snp']:
                al = rp
            if al == rp:
                continue
            if al in ('-', 'D'):
                n_gap += 1
            elif '+' in al:
                n_ins += 1
            else:
                n_snp += 1

        result.append({
            'id': f'Hap{i + 1}', 'label': f'Haplotype {i + 1}',
            'samples': samples, 'pattern': pat,
            'nSnp': n_snp, 'nGap': n_gap, 'nIns': n_ins,
            'nVariants': n_snp + n_gap + n_ins,
            'nSamples': len(samples),
        })
    return result


def compute_combos(position_data, ref_seq, sample_ids):
    """Compute 14 combinations (gene/cds × 7 flag)."""
    allele_map = {pd['pos']: pd for pd in position_data}
    combos = {}

    flag_combos = []
    for s in (0, 1):
        for ind in (0, 1):
            for g in (0, 1):
                if s == 0 and ind == 0 and g == 0:
                    continue
                flag_combos.append({
                    'snp': bool(s), 'indel': bool(ind), 'gap': bool(g),
                    'key': f'{s}{ind}{g}'
                })

    for target in ('gene', 'cds'):
        for fc in flag_combos:
            key = f"{target}_{fc['key']}"
            positions = []
            for pd in position_data:
                f = pd['f']
                in_cds = bool(f & 32)
                in_gene = bool(f & 16)
                has_snp = bool(f & 1)
                has_del = bool(f & 2)
                has_no_cov = bool(f & 4)
                has_ins = bool(f & 8)
                if target == 'cds' and not in_cds:
                    continue
                if target == 'gene' and not in_gene:
                    continue
                match = False
                if fc['snp'] and has_snp:
                    match = True
                if fc['indel'] and (has_ins or has_del):
                    match = True
                if fc['gap'] and has_no_cov:
                    match = True
                if match:
                    positions.append(pd['pos'])

            haplotypes = build_haplotypes(positions, ref_seq, sample_ids, allele_map, fc)
            combos[key] = {
                'haplotypes': haplotypes,
                'variantPositions': positions,
            }

    return combos


# ─── Main per-gene processing ──────────────────────────────────────────────────
def process_gene(gene_id, data_dir, gene_info):
    """Process a single gene → save precomputed.json."""
    try:
        # File paths
        group_name = gene_info['group']
        gene_dir = os.path.join(data_dir, group_name)

        # flat or sub structure
        fa_flat = os.path.join(gene_dir, f'{gene_id}.fa')
        gff_flat = os.path.join(gene_dir, f'{gene_id}.local.gff3')
        fa_sub = os.path.join(gene_dir, gene_id, f'{gene_id}.fa')
        gff_sub = os.path.join(gene_dir, gene_id, f'{gene_id}.local.gff3')

        if os.path.exists(fa_flat):
            fa_path, gff_path = fa_flat, gff_flat
        elif os.path.exists(fa_sub):
            fa_path, gff_path = fa_sub, gff_sub
        else:
            return gene_id, False, f'FA/GFF3 file missing'

        # pileup path
        pileup_dir = os.path.join(data_dir, 'pileup', gene_id)
        all_json = os.path.join(pileup_dir, 'all.json')
        samples_json = os.path.join(data_dir, 'bam', gene_id, 'samples.json')

        if not os.path.exists(samples_json):
            return gene_id, False, 'samples.json missing'

        with open(samples_json) as f:
            sample_ids = json.load(f)

        if not sample_ids:
            return gene_id, False, 'no samples'

        # Load pileup
        pileup_cache = {}
        if os.path.exists(all_json):
            with open(all_json) as f:
                merged = json.load(f)
            for sid in sample_ids:
                pileup_cache[sid] = merged.get(sid)
        else:
            for sid in sample_ids:
                p = os.path.join(pileup_dir, f'{sid}.json')
                if os.path.exists(p):
                    with open(p) as f:
                        d = json.load(f)
                    pileup_cache[sid] = d.get('pileup')
                else:
                    pileup_cache[sid] = None

        # ref seq + GFF3
        ref_seq = parse_fasta(fa_path)
        features = parse_gff3(gff_path)

        meta = gene_info
        offset = meta['offset']
        region_length = meta['region_length']
        gene_start_abs = meta['gene_start']
        gene_end_abs = meta['gene_end']
        strand = meta.get('strand', '+')

        gene_local_start = gene_start_abs - offset
        gene_local_end = gene_end_abs - offset

        # CDS info
        cds_local_set, cds_seq_map, cds_concat, _ = build_cds_info(
            features, gene_id, ref_seq, offset, strand
        )

        # positionData + msaInsData
        position_data, msa_ins_data = build_position_data(
            ref_seq, region_length, sample_ids, pileup_cache,
            gene_local_start, gene_local_end,
            cds_local_set, cds_seq_map, cds_concat, strand
        )

        # 14 combos
        combos = compute_combos(position_data, ref_seq, sample_ids)

        # Save
        out_dir = os.path.join(data_dir, 'precomputed')
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f'{gene_id}.json')

        result = {
            'gene_id': gene_id,
            'region_length': region_length,
            'offset': offset,
            'gene_start': gene_start_abs,
            'gene_end': gene_end_abs,
            'strand': strand,
            'samples': sample_ids,
            'combos': combos,
            'positionData': position_data,
            'msaInsData': msa_ins_data,
            'cdsSeq': cds_concat,   # CDS sequence 5'→3'
            'cdsMap': {              # local_pos → {ci: cds_index, cn: codon_num(1-based), cp: codon_pos(0,1,2)}
                str(pos): {
                    'ci': idx,
                    'cn': idx // 3 + 1,
                    'cp': idx % 3
                }
                for pos, idx in cds_seq_map.items()
            },
        }

        with open(out_path, 'w') as f:
            json.dump(result, f, ensure_ascii=False, separators=(',', ':'))

        size_kb = os.path.getsize(out_path) // 1024
        n_pos = len(position_data)
        n_hap = max(
            len(v['haplotypes']) for v in combos.values()
        ) if combos else 0
        return gene_id, True, f'{n_pos} variant pos, max {n_hap} haplotypes, {size_kb} KB'

    except Exception as e:
        import traceback
        return gene_id, False, f'ERROR: {e}\n{traceback.format_exc()}'


def find_data_dir():
    cwd = os.getcwd()
    for c in [
        os.path.join(cwd, 'public', 'data'),
        os.path.join(cwd, 'data'),
        os.path.join(cwd, '..', 'public', 'data'),
    ]:
        if os.path.isdir(c):
            return os.path.abspath(c)
    return None


def load_gene_list(data_dir, target_gene=None):
    """Load gene list from index.json. If target_gene is given, only that one."""
    index_path = os.path.join(data_dir, 'index.json')
    if not os.path.exists(index_path):
        print(f'ERROR: {index_path} not found. Run generate_index.py first.')
        sys.exit(1)

    with open(index_path) as f:
        index = json.load(f)

    genes = []
    for group in index.get('groups', []):
        for g in group.get('genes', []):
            g['group'] = group['name']
            if target_gene is None or g['id'] == target_gene:
                genes.append(g)

    return genes


def main():
    parser = argparse.ArgumentParser(description='HapBrowser precompute.py')
    parser.add_argument('--data-dir', help='Data directory (auto-detected if omitted)')
    parser.add_argument('--gene', help='Process a single gene only (e.g. Os06g0275000)')
    parser.add_argument('--jobs', type=int, default=4, help='Number of parallel workers (default: 4)')
    parser.add_argument('--force', action='store_true', help='Regenerate even if output exists')
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir) if args.data_dir else find_data_dir()
    if not data_dir or not os.path.isdir(data_dir):
        print(f'ERROR: data/ folder not found. Specify --data-dir.')
        sys.exit(1)

    print(f'Data directory: {data_dir}')
    genes = load_gene_list(data_dir, args.gene)

    if not genes:
        print('No genes to process.')
        sys.exit(0)

    # Skip already processed
    if not args.force:
        pending = []
        for g in genes:
            out = os.path.join(data_dir, 'precomputed', f"{g['id']}.json")
            if os.path.exists(out):
                print(f"  skip {g['id']} (already exists, --force to rerun)")
            else:
                pending.append(g)
        genes = pending

    if not genes:
        print('All genes already processed.')
        return

    print(f'\nProcessing {len(genes)} gene(s) (workers={args.jobs})\n')
    ok = fail = 0

    if args.jobs == 1:
        for g in genes:
            gid, success, msg = process_gene(g['id'], data_dir, g)
            status = '✓' if success else '✗'
            print(f'  {status} {gid}: {msg}')
            if success:
                ok += 1
            else:
                fail += 1
    else:
        with ProcessPoolExecutor(max_workers=args.jobs) as exe:
            futures = {
                exe.submit(process_gene, g['id'], data_dir, g): g['id']
                for g in genes
            }
            for fut in as_completed(futures):
                gid, success, msg = fut.result()
                status = '✓' if success else '✗'
                print(f'  {status} {gid}: {msg}')
                if success:
                    ok += 1
                else:
                    fail += 1

    print(f'\nDone: {ok} succeeded, {fail} failed')
    print(f'Output: {data_dir}/precomputed/')


if __name__ == '__main__':
    main()
