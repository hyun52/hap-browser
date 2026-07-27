#!/usr/bin/env python3
"""
generate_pileup.py
------------------
BAM files → pileup JSON with insertion sequences.

Usage:
    cd hap-browser/
    python scripts/generate_pileup.py

    # Or specific gene:
    python scripts/generate_pileup.py --gene Os06g0275000

    # Parallel (default: 4 workers):
    python scripts/generate_pileup.py --workers 8

Requirements:
    pip install pysam

Input:
    data/bam/{gene_id}/{sample}.bam  (+ .bai index)
    data/index.json                  (for region info)

Output:
    data/pileup/{gene_id}/{sample}.json

Pileup JSON format:
    {
      "gene_id": "Os06g0275000",
      "sample_id": "ERS468318",
      "region_length": 12194,
      "pileup": {
        "1": { "A": 0, "T": 30, "G": 0, "C": 0, "del": 0, "ins": 2,
               "ins_seqs": {"AT": 1, "ATG": 1} },
        "2": { "A": 28, "T": 0, "G": 0, "C": 0, "del": 0, "ins": 0 },
        ...
      }
    }

Notes:
    - ins_seqs: dict of insertion sequences → count
      Only present when ins > 0
    - Positions are 1-based (local coordinates)
    - Only positions with depth > 0 are included
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

# ── Read-level filter defaults ───────────────────────────────────────────────
# The base-quality threshold follows the default of `samtools mpileup`.
#
# The proper-pair requirement, which samtools applies by default, is NOT enabled
# here. When reads are aligned against a single extracted locus, the aligner
# estimates its insert-size distribution from a reference of a few tens of
# kilobases against which almost no read aligns, and the resulting pair flags are
# not informative: measured on one accession, 96.3% of alignments were flagged as
# properly paired against the whole genome, against 11.6% for the same reads
# aligned to a 20 kb locus. Requiring proper pairs under those conditions
# discards most genuine coverage. Alignments failing the requirement are
# therefore counted rather than removed, and the count is retained per position
# as "xpp" so that positions liable to receive reads from elsewhere in the genome
# remain identifiable in the interface.
#
# The requirement can be enabled with --require-proper-pair, which is appropriate
# when pileups are generated from genome-wide alignments.
DEFAULT_MIN_BASEQ = 13
DEFAULT_MIN_MAPQ = 0
DEFAULT_REQUIRE_PROPER_PAIR = False

try:
    import pysam
except ImportError:
    print("Error: pysam required. Install with:")
    print("  pip install pysam")
    sys.exit(1)


BAM_FPROPER_PAIR = 0x2


def process_bam(bam_path, gene_id, sample_id, region_chr, region_start, region_end, region_length, offset,
                min_baseq=DEFAULT_MIN_BASEQ, min_mapq=DEFAULT_MIN_MAPQ,
                require_proper_pair=DEFAULT_REQUIRE_PROPER_PAIR):
    """
    Process a single BAM file and extract pileup data with insertion sequences.

    BAM files use gene_id as contig name with local coordinates (1-based).

    Read-level filters
    ------------------
    min_baseq            Bases with a Phred quality below this value are discarded.
                         Matches the `samtools mpileup -Q` default of 13.
    min_mapq             Alignments with MAPQ below this value are discarded.
                         Note that per-gene BAMs are aligned against a single
                         extracted locus, so there is no competing placement and
                         MAPQ is uninformative; this is retained for genome-wide
                         BAM input, where MAPQ is meaningful.
    require_proper_pair  Keep only alignments flagged as a proper pair (0x2).
                         Reads whose mate does not map concordantly within the
                         extracted locus are the dominant source of spurious
                         mixed-allele calls in the flanking regions.

    When require_proper_pair is enabled, the number of reads rejected by that
    filter is retained per position as "xpp" so that positions prone to
    mismapping remain visible to the user rather than being silently dropped.
    """
    pileup = {}

    try:
        bam = pysam.AlignmentFile(bam_path, "rb")
    except Exception as e:
        print(f"  x Cannot open {bam_path}: {e}")
        return None

    try:
        # Determine contig name from BAM header
        refs = bam.references
        # Try gene_id first, then chr name
        contig = None
        for r in refs:
            if r == gene_id:
                contig = r
                break
        if contig is None:
            for r in refs:
                if region_chr in r or r in region_chr:
                    contig = r
                    break
        if contig is None and len(refs) == 1:
            contig = refs[0]  # Single contig BAM
        
        if contig is None:
            print(f"  x No matching contig in {bam_path} (refs: {list(refs)[:3]})")
            bam.close()
            return None

        # Determine if coordinates are local (contig=gene_id) or genomic
        contig_len = bam.get_reference_length(contig)
        use_local = (contig == gene_id and contig_len <= region_length + 100)

        if use_local:
            # Local coordinates: 1 ~ region_length
            fetch_start = 0  # 0-based
            fetch_end = region_length
        else:
            # Genomic coordinates
            fetch_start = region_start - 1
            fetch_end = region_end

        # The base-quality filter is applied explicitly in the loop below rather
        # than through pysam's min_base_quality, so that a rejected base is not
        # confused with absent coverage.
        for col in bam.pileup(contig, fetch_start, fetch_end,
                              min_base_quality=0, min_mapping_quality=min_mapq,
                              truncate=True, stepper='all'):
            if use_local:
                local_pos = col.reference_pos + 1  # 0-based → 1-based local
            else:
                genomic_pos = col.reference_pos + 1
                local_pos = genomic_pos - offset

            if local_pos < 1 or local_pos > region_length:
                continue

            counts = {'A': 0, 'T': 0, 'G': 0, 'C': 0, 'del': 0, 'ins': 0}
            ins_seqs = defaultdict(int)
            n_improper = 0
            n_lowq = 0

            for read in col.pileups:
                aln = read.alignment

                # Reject alignments that are not in a proper pair. Retain the
                # count so that the discarded evidence stays inspectable.
                if require_proper_pair and not (aln.flag & BAM_FPROPER_PAIR):
                    n_improper += 1
                    continue

                # Reject low-quality bases. Deleted and skipped positions carry
                # no base quality of their own and are exempt.
                if not read.is_del and not read.is_refskip and min_baseq > 0:
                    quals = aln.query_qualities
                    qpos = read.query_position
                    if quals is not None and qpos is not None and quals[qpos] < min_baseq:
                        n_lowq += 1
                        continue

                if read.is_del:
                    counts['del'] += 1
                elif read.is_refskip:
                    continue
                else:
                    base = read.alignment.query_sequence[read.query_position].upper()
                    if base in 'ATGC':
                        counts[base] += 1

                # Check for insertion at this position
                if read.indel > 0 and not read.is_del and not read.is_refskip:
                    qpos = read.query_position
                    if qpos is not None:
                        ins_len = read.indel
                        ins_seq = read.alignment.query_sequence[qpos + 1: qpos + 1 + ins_len].upper()
                        if ins_seq:
                            counts['ins'] += 1
                            ins_seqs[ins_seq] += 1

            total = counts['A'] + counts['T'] + counts['G'] + counts['C'] + counts['del']
            if total > 0 or counts['ins'] > 0 or n_improper > 0:
                entry = counts.copy()
                if ins_seqs:
                    entry['ins_seqs'] = dict(ins_seqs)
                # Only recorded when non-zero, so unaffected positions cost nothing.
                if n_improper:
                    entry['xpp'] = n_improper
                if n_lowq:
                    entry['xbq'] = n_lowq
                pileup[str(local_pos)] = entry

    except Exception as e:
        print(f"  x Error processing {bam_path}: {e}")
    finally:
        bam.close()

    return {
        'gene_id': gene_id,
        'sample_id': sample_id,
        'region_length': region_length,
        'filters': {
            'min_baseq': min_baseq,
            'min_mapq': min_mapq,
            'require_proper_pair': bool(require_proper_pair),
        },
        'pileup': pileup,
    }


def process_one(args):
    """Worker function for parallel processing."""
    (bam_path, gene_id, sample_id, out_path, region_chr, region_start, region_end,
     region_length, offset, force, min_baseq, min_mapq, require_proper_pair) = args

    if not force and os.path.exists(out_path):
        try:
            with open(out_path) as f:
                existing = json.load(f)
            pileup = existing.get('pileup', {})
            has_ins_seqs = any('ins_seqs' in v for v in pileup.values() if isinstance(v, dict))
            # A pileup written under a different filter setting must be rebuilt,
            # otherwise a run would silently mix incompatible files.
            prev = existing.get('filters')
            same_filters = prev == {
                'min_baseq': min_baseq,
                'min_mapq': min_mapq,
                'require_proper_pair': bool(require_proper_pair),
            }
            if has_ins_seqs and same_filters:
                return f"  · {gene_id}/{sample_id} (skip, up to date)"
        except:
            pass

    result = process_bam(bam_path, gene_id, sample_id,
                         region_chr, region_start, region_end, region_length, offset,
                         min_baseq=min_baseq, min_mapq=min_mapq,
                         require_proper_pair=require_proper_pair)

    if result is None:
        return f"  x {gene_id}/{sample_id} (failed)"

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(result, f, separators=(',', ':'))

    n_pos = len(result['pileup'])
    n_ins = sum(1 for v in result['pileup'].values() if isinstance(v, dict) and v.get('ins', 0) > 0)
    return f"  ✓ {gene_id}/{sample_id} ({n_pos} pos, {n_ins} ins)"


def main():
    parser = argparse.ArgumentParser(description='Generate pileup JSON from BAM files')
    parser.add_argument('--data-dir', default='./public/data',
                        help='Path to data directory (default: ./public/data)')
    parser.add_argument('--gene', default=None,
                        help='Process only this gene ID (default: all)')
    parser.add_argument('--sample', default=None,
                        help='Process only this sample ID (default: all)')
    parser.add_argument('--workers', type=int, default=4,
                        help='Number of parallel workers (default: 4)')
    parser.add_argument('--force', action='store_true',
                        help='Force regeneration even if pileup exists')
    parser.add_argument('--min-baseq', type=int, default=DEFAULT_MIN_BASEQ,
                        help=f'Discard bases below this Phred quality '
                             f'(default: {DEFAULT_MIN_BASEQ}, as in samtools mpileup)')
    parser.add_argument('--min-mapq', type=int, default=DEFAULT_MIN_MAPQ,
                        help=f'Discard alignments below this mapping quality '
                             f'(default: {DEFAULT_MIN_MAPQ}; uninformative for per-gene BAMs)')
    parser.add_argument('--require-proper-pair', dest='require_proper_pair',
                        action='store_true', default=DEFAULT_REQUIRE_PROPER_PAIR,
                        help='Count only alignments flagged as a proper pair. '
                             'Meaningful for genome-wide alignments; for per-gene '
                             'alignments the flag is unreliable and enabling this '
                             'discards most genuine coverage (default: off).')
    parser.add_argument('--bam-dir', default=None,
                        help='Directory of existing alignments to summarise instead of the '
                             'per-gene BAMs under <data-dir>/bam. Files are looked up as '
                             '<bam-dir>/<sample>.bam, and genome-wide alignments are '
                             'detected from the BAM header and converted to local '
                             'coordinates automatically.')
    args = parser.parse_args()

    data_dir = Path(args.data_dir).resolve()
    index_path = data_dir / 'index.json'

    if not index_path.exists():
        print(f"Error: {index_path} not found. Run generate_index.py first.")
        sys.exit(1)

    with open(index_path) as f:
        index = json.load(f)

    print(f"\n{'='*55}")
    print(f"  Generate Pileup JSON (with insertion sequences)")
    print(f"{'='*55}")
    print(f"  data: {data_dir}")
    print(f"  workers: {args.workers}")
    print(f"  min base quality: {args.min_baseq}")
    print(f"  min mapping quality: {args.min_mapq}")
    print(f"  proper pairs only: {args.require_proper_pair}")
    if args.bam_dir:
        print(f"  alignment source: {args.bam_dir} (shared across genes)")
    if args.gene:
        print(f"  gene filter: {args.gene}")
    if args.force:
        print(f"  force: True")
    print()

    # Collect tasks
    tasks = []
    for group in index.get('groups', []):
        for gi in group.get('genes', []):
            gene_id = gi['id']
            if args.gene and gene_id != args.gene:
                continue

            # With --bam-dir the same set of alignments serves every gene, so
            # the locus is taken from the BAM header rather than from a
            # per-gene directory. This is the path to use when genome-wide
            # alignments already exist, and it also avoids the unreliable pair
            # flags that per-locus alignment produces.
            if args.bam_dir:
                bam_dir = Path(args.bam_dir)
            else:
                bam_dir = data_dir / 'bam' / gene_id
            if not bam_dir.exists():
                print(f"  - {gene_id}: no BAM directory ({bam_dir})")
                continue

            region_chr = gi.get('chr', '')
            region_start = gi.get('region_start', 0)
            region_end = gi.get('region_end', 0)
            region_length = gi.get('region_length', 0)
            offset = gi.get('offset', 0)

            bam_files = sorted(bam_dir.glob('*.bam'))
            bam_files = [b for b in bam_files if not str(b).endswith('.bai')]

            for bam_path in bam_files:
                sample_id = bam_path.stem
                if args.sample and sample_id != args.sample:
                    continue

                out_path = str(data_dir / 'pileup' / gene_id / f'{sample_id}.json')

                tasks.append((
                    str(bam_path), gene_id, sample_id, out_path,
                    region_chr, region_start, region_end, region_length, offset,
                    args.force, args.min_baseq, args.min_mapq, args.require_proper_pair,
                ))

    if not tasks:
        print("  No BAM files to process (all pileups up to date)")
        print(f"\n{'='*55}")
        return

    print(f"  Processing {len(tasks)} BAM files...\n")
    start = time.time()

    if args.workers == 1:
        for t in tasks:
            msg = process_one(t)
            print(msg)
    else:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(process_one, t): t for t in tasks}
            done = 0
            for future in as_completed(futures):
                done += 1
                msg = future.result()
                print(f"  [{done}/{len(tasks)}] {msg}")

    elapsed = time.time() - start
    print(f"\n  Done in {elapsed:.1f}s ({len(tasks)} files)")
    print(f"{'='*55}\n")


if __name__ == '__main__':
    main()
