#!/usr/bin/env python3
"""
Extract gene regions from RAP-DB genome and GFF files.

For each gene in the input list:
  1. Extract FASTA sequence: gene_start - 3kb to gene_end + 1kb
  2. Extract GFF annotations (from both locus.gff and transcripts.gff) in that range
  3. Output:
     - {gene}.fa           : FASTA with header containing original coordinates
     - {gene}.local.gff3   : GFF with local coordinates (1-based, for mini genome browser)
     - {gene}.original.gff3: GFF with original RAP-DB coordinates (for reference)
     - {gene}.meta.json    : Coordinate mapping metadata

Usage:
    python extract_gene_regions.py \
        --genome IRGSP-1.0_genome.fasta \
        --locus locus.gff \
        --transcripts transcripts.gff \
        --gene-list gene_list.txt \
        --upstream 3000 \
        --downstream 1000 \
        --outdir output/
"""

import argparse
import json
import os
import sys
from collections import defaultdict


def parse_fasta_index(genome_path):
    """
    Read genome FASTA and build an index {chr: sequence}.
    For large genomes, consider using pysam or samtools faidx instead.
    Here we load chromosomes into memory for simplicity.
    """
    print("[INFO] Loading genome FASTA...")
    sequences = {}
    current_chr = None
    current_seq = []

    with open(genome_path, "r") as f:
        for line in f:
            line = line.strip()
            if line.startswith(">"):
                if current_chr is not None:
                    sequences[current_chr] = "".join(current_seq)
                current_chr = line[1:].split()[0]  # first word after >
                current_seq = []
            else:
                current_seq.append(line)
        if current_chr is not None:
            sequences[current_chr] = "".join(current_seq)

    print(f"[INFO] Loaded {len(sequences)} chromosomes/scaffolds")
    for chrom, seq in sequences.items():
        print(f"       {chrom}: {len(seq):,} bp")
    return sequences


def parse_locus_gff(locus_path):
    """
    Parse locus.gff to build a gene -> (chr, start, end, strand, attributes) mapping.
    """
    print("[INFO] Parsing locus.gff...")
    genes = {}
    with open(locus_path, "r") as f:
        for line in f:
            if line.startswith("#") or line.strip() == "":
                continue
            fields = line.strip().split("\t")
            if len(fields) < 9:
                continue
            chrom, source, ftype, start, end, score, strand, phase, attrs = fields
            if ftype != "gene":
                continue

            # Parse gene ID from attributes
            attr_dict = {}
            for item in attrs.split(";"):
                if "=" in item:
                    key, val = item.split("=", 1)
                    attr_dict[key] = val

            gene_id = attr_dict.get("ID", "")
            if gene_id:
                genes[gene_id] = {
                    "chr": chrom,
                    "start": int(start),
                    "end": int(end),
                    "strand": strand,
                    "source": source,
                    "attributes": attrs,
                }

    print(f"[INFO] Found {len(genes)} genes in locus.gff")
    return genes


def parse_transcript_gff_by_locus(transcripts_path):
    """
    Parse transcripts.gff and group entries by Locus_id.
    Returns: {locus_id: [list of GFF lines as dicts]}
    """
    print("[INFO] Parsing transcripts.gff...")
    # First pass: build transcript_id -> locus_id mapping from mRNA lines
    transcript_to_locus = {}
    locus_entries = defaultdict(list)

    with open(transcripts_path, "r") as f:
        for line in f:
            if line.startswith("#") or line.strip() == "":
                continue
            fields = line.strip().split("\t")
            if len(fields) < 9:
                continue

            chrom, source, ftype, start, end, score, strand, phase, attrs = fields

            # Parse attributes
            attr_dict = {}
            for item in attrs.split(";"):
                if "=" in item:
                    key, val = item.split("=", 1)
                    attr_dict[key] = val

            entry = {
                "chr": chrom,
                "source": source,
                "type": ftype,
                "start": int(start),
                "end": int(end),
                "score": score,
                "strand": strand,
                "phase": phase,
                "attributes": attrs,
                "attr_dict": attr_dict,
            }

            if ftype == "mRNA":
                locus_id = attr_dict.get("Locus_id", "")
                transcript_id = attr_dict.get("ID", "")
                if locus_id and transcript_id:
                    transcript_to_locus[transcript_id] = locus_id
                    locus_entries[locus_id].append(entry)
            else:
                # For CDS, UTR, exon etc., use Parent to find locus
                parent = attr_dict.get("Parent", "")
                locus_id = transcript_to_locus.get(parent, "")
                if locus_id:
                    locus_entries[locus_id].append(entry)

    print(f"[INFO] Found transcript entries for {len(locus_entries)} loci")
    return locus_entries


def extract_gene_region(
    gene_id, gene_info, genome_seqs, transcript_entries,
    upstream=3000, downstream=1000
):
    """
    Extract sequence and GFF for a gene region.
    Region: [gene_start - upstream, gene_end + downstream] (1-based, inclusive)

    Note: upstream/downstream are relative to the GENOMIC coordinates,
    not strand direction. This ensures the extracted region always covers
    the promoter region upstream of TSS regardless of strand.
    Actually, let's think about this more carefully:
    - For + strand genes: promoter is before start → start - upstream
    - For - strand genes: promoter is after end → end + downstream should be larger

    Per user request: start - 3kb, end + 1kb (genomic coordinates).
    If they want strand-aware extraction later, we can adjust.
    """
    chrom = gene_info["chr"]
    gene_start = gene_info["start"]
    gene_end = gene_info["end"]
    strand = gene_info["strand"]

    if chrom not in genome_seqs:
        print(f"[WARN] Chromosome {chrom} not found for gene {gene_id}, skipping.")
        return None

    chr_len = len(genome_seqs[chrom])

    # Define extraction region (1-based coordinates)
    region_start = max(1, gene_start - upstream)
    region_end = min(chr_len, gene_end + downstream)

    # Extract sequence (convert to 0-based for Python slicing)
    seq = genome_seqs[chrom][region_start - 1 : region_end]

    # Offset for local coordinate conversion
    offset = region_start - 1  # subtract this from original coords to get local

    # Collect GFF entries in this region
    # 1) Gene entry from locus.gff
    locus_gff_entries = []
    gene_gff_line = {
        "chr": chrom,
        "source": gene_info["source"],
        "type": "gene",
        "start": gene_start,
        "end": gene_end,
        "score": ".",
        "strand": strand,
        "phase": ".",
        "attributes": gene_info["attributes"],
    }
    locus_gff_entries.append(gene_gff_line)

    # 2) Transcript entries
    if gene_id in transcript_entries:
        for entry in transcript_entries[gene_id]:
            # Include if overlaps with our region
            if entry["end"] >= region_start and entry["start"] <= region_end:
                locus_gff_entries.append(entry)

    # Also check for OTHER genes/transcripts that overlap this region
    # (we'll handle this at a higher level by scanning all genes)

    # Build output
    result = {
        "gene_id": gene_id,
        "chr": chrom,
        "strand": strand,
        "gene_start": gene_start,
        "gene_end": gene_end,
        "region_start": region_start,
        "region_end": region_end,
        "region_length": region_end - region_start + 1,
        "offset": offset,
        "sequence": seq,
        "gff_entries": locus_gff_entries,
    }

    return result


def find_overlapping_genes(all_genes, chrom, region_start, region_end, exclude_gene_id):
    """
    Find all genes that overlap with the given region (for including
    neighboring gene annotations in the extracted GFF).
    """
    overlapping = []
    for gid, ginfo in all_genes.items():
        if gid == exclude_gene_id:
            continue
        if ginfo["chr"] != chrom:
            continue
        if ginfo["end"] >= region_start and ginfo["start"] <= region_end:
            overlapping.append(gid)
    return overlapping


def format_gff_line(entry, chrom_name="extracted_region", offset=0, local=True):
    """
    Format a GFF entry as a GFF3 line.
    If local=True, adjust coordinates by subtracting offset.
    """
    if local:
        start = entry["start"] - offset
        end = entry["end"] - offset
        chrom = chrom_name
    else:
        start = entry["start"]
        end = entry["end"]
        chrom = entry["chr"]

    return f"{chrom}\t{entry['source']}\t{entry['type']}\t{start}\t{end}\t{entry['score']}\t{entry['strand']}\t{entry['phase']}\t{entry['attributes']}"


def write_fasta(filepath, gene_id, chrom, region_start, region_end, strand, sequence):
    """Write FASTA file with informative header."""
    with open(filepath, "w") as f:
        header = f">{gene_id} {chrom}:{region_start}-{region_end} strand={strand} length={len(sequence)}"
        f.write(header + "\n")
        # Write sequence in 80-char lines
        for i in range(0, len(sequence), 80):
            f.write(sequence[i : i + 80] + "\n")


def write_gff(filepath, entries, chrom_name, offset, local=True):
    """Write GFF3 file."""
    with open(filepath, "w") as f:
        f.write("##gff-version 3\n")
        if local:
            # Add region directive
            max_end = max(e["end"] - offset for e in entries) if entries else 0
            f.write(f"##sequence-region {chrom_name} 1 {max_end}\n")

        for entry in sorted(entries, key=lambda x: (x["start"], x["end"])):
            f.write(format_gff_line(entry, chrom_name, offset, local) + "\n")


def write_meta(filepath, meta):
    """Write metadata JSON."""
    with open(filepath, "w") as f:
        json.dump(meta, f, indent=2)


def main():
    parser = argparse.ArgumentParser(
        description="Extract gene regions from RAP-DB genome and GFF files."
    )
    parser.add_argument(
        "--genome", required=True, help="Path to IRGSP-1.0_genome.fasta"
    )
    parser.add_argument("--locus", required=True, help="Path to locus.gff")
    parser.add_argument("--transcripts", required=True, help="Path to transcripts.gff")
    parser.add_argument(
        "--gene-list",
        required=True,
        help="Text file with one gene ID per line (e.g., Os01g0100100)",
    )
    parser.add_argument(
        "--upstream",
        type=int,
        default=3000,
        help="Upstream extension from gene start (default: 3000)",
    )
    parser.add_argument(
        "--downstream",
        type=int,
        default=1000,
        help="Downstream extension from gene end (default: 1000)",
    )
    parser.add_argument(
        "--outdir", default="output", help="Output directory (default: output/)"
    )
    parser.add_argument(
        "--include-neighbors",
        action="store_true",
        default=True,
        help="Include overlapping neighbor gene annotations (default: True)",
    )

    args = parser.parse_args()

    # Create output directory
    os.makedirs(args.outdir, exist_ok=True)

    # Read gene list
    with open(args.gene_list, "r") as f:
        gene_list = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    print(f"[INFO] Gene list: {len(gene_list)} genes")

    # Parse inputs
    genome_seqs = parse_fasta_index(args.genome)
    all_genes = parse_locus_gff(args.locus)
    transcript_entries = parse_transcript_gff_by_locus(args.transcripts)

    # Process each gene
    success_count = 0
    fail_count = 0

    for gene_id in gene_list:
        if gene_id not in all_genes:
            print(f"[WARN] Gene {gene_id} not found in locus.gff, skipping.")
            fail_count += 1
            continue

        gene_info = all_genes[gene_id]
        result = extract_gene_region(
            gene_id, gene_info, genome_seqs, transcript_entries,
            upstream=args.upstream, downstream=args.downstream,
        )

        if result is None:
            fail_count += 1
            continue

        # Collect all GFF entries for this region (including neighbors)
        all_gff_entries = list(result["gff_entries"])

        if args.include_neighbors:
            neighbor_ids = find_overlapping_genes(
                all_genes,
                result["chr"],
                result["region_start"],
                result["region_end"],
                gene_id,
            )
            for nid in neighbor_ids:
                # Add neighbor gene entry
                ninfo = all_genes[nid]
                neighbor_gene_entry = {
                    "chr": ninfo["chr"],
                    "source": ninfo["source"],
                    "type": "gene",
                    "start": ninfo["start"],
                    "end": ninfo["end"],
                    "score": ".",
                    "strand": ninfo["strand"],
                    "phase": ".",
                    "attributes": ninfo["attributes"],
                }
                all_gff_entries.append(neighbor_gene_entry)

                # Add neighbor transcript entries
                if nid in transcript_entries:
                    for entry in transcript_entries[nid]:
                        if (
                            entry["end"] >= result["region_start"]
                            and entry["start"] <= result["region_end"]
                        ):
                            all_gff_entries.append(entry)

        # Clip GFF entries to region boundaries
        clipped_entries = []
        for entry in all_gff_entries:
            clipped = dict(entry)
            clipped["start"] = max(entry["start"], result["region_start"])
            clipped["end"] = min(entry["end"], result["region_end"])
            if clipped["start"] <= clipped["end"]:
                clipped_entries.append(clipped)

        # Create gene output directory
        gene_outdir = os.path.join(args.outdir, gene_id)
        os.makedirs(gene_outdir, exist_ok=True)

        # Write FASTA
        fa_path = os.path.join(gene_outdir, f"{gene_id}.fa")
        write_fasta(
            fa_path,
            gene_id,
            result["chr"],
            result["region_start"],
            result["region_end"],
            result["strand"],
            result["sequence"],
        )

        # Write local coordinate GFF (1-based)
        local_gff_path = os.path.join(gene_outdir, f"{gene_id}.local.gff3")
        write_gff(
            local_gff_path,
            clipped_entries,
            chrom_name=gene_id,
            offset=result["offset"],
            local=True,
        )

        # Write original coordinate GFF
        orig_gff_path = os.path.join(gene_outdir, f"{gene_id}.original.gff3")
        write_gff(
            orig_gff_path,
            clipped_entries,
            chrom_name=gene_id,
            offset=0,
            local=False,
        )

        # Write metadata
        meta = {
            "gene_id": gene_id,
            "chromosome": result["chr"],
            "strand": result["strand"],
            "gene_start": result["gene_start"],
            "gene_end": result["gene_end"],
            "region_start": result["region_start"],
            "region_end": result["region_end"],
            "region_length": result["region_length"],
            "upstream_bp": args.upstream,
            "downstream_bp": args.downstream,
            "offset": result["offset"],
            "coordinate_note": (
                f"To convert local coords to RAP-DB coords: "
                f"local_pos + {result['offset']} = original_pos"
            ),
            "fasta_header": (
                f">{gene_id} {result['chr']}:{result['region_start']}-{result['region_end']} "
                f"strand={result['strand']} length={result['region_length']}"
            ),
        }

        if args.include_neighbors:
            neighbor_ids = find_overlapping_genes(
                all_genes,
                result["chr"],
                result["region_start"],
                result["region_end"],
                gene_id,
            )
            if neighbor_ids:
                meta["overlapping_genes"] = neighbor_ids

        meta_path = os.path.join(gene_outdir, f"{gene_id}.meta.json")
        write_meta(meta_path, meta)

        print(
            f"[OK] {gene_id}: {result['chr']}:{result['region_start']}-{result['region_end']} "
            f"({result['region_length']:,} bp, {len(clipped_entries)} GFF entries)"
        )
        success_count += 1

    print(f"\n[DONE] Processed: {success_count} success, {fail_count} failed")
    print(f"[DONE] Output directory: {args.outdir}/")


if __name__ == "__main__":
    main()
