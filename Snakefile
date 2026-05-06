"""
Snakefile — HapBrowser Full Data Pipeline
==========================================

Full pipeline in one run:

    FASTQ + RAP-DB reference
        ↓  extract_regions        (region FASTA + local GFF3 + meta.json)
        ↓  bwa_index              (bwa-mem2 index)
        ↓  map_bwa                (per-sample BAM)
        ↓  pileup                 (per-sample JSON pileup)
        ↓  merge_pileup           (per-gene all.json)
        ↓  precompute             (haplotype combos)
        ↓  index                  (index.json)
    → Browser ready

Usage
-----
    # Full pipeline (driven by genes.tsv)
    snakemake --cores 72 all

    # Add new gene(s) only (existing outputs auto-skipped via Snakemake DAG)
    snakemake --cores 72 all

    # Specific gene only
    snakemake --cores 8 public/data/precomputed/Os07g0281400.json

    # Dry-run (plan only)
    snakemake -n all

    # Pipeline report (for paper supplementary)
    snakemake --report pipeline_report.html

Inputs
------
    genes.tsv             : gene registry (single source of truth)
    Paths provided via --config options:
        genome_fasta      : /path/to/IRGSP-1.0_genome.fasta
        locus_gff         : /path/to/locus.gff
        transcripts_gff   : /path/to/transcripts.gff
        fastq_dir         : /data/.../fastq/trimmed
        upstream          : 5000 (default)
        downstream        : 5000 (default)
"""

import os
import json
import glob

# ─────────────────────────────────────────────────────────────────────────
# Config — all values passed via --config options (no configfile needed)
# ─────────────────────────────────────────────────────────────────────────
# add_genes.sh passes all parameters via --config, so no configfile is used.
# To run snakemake directly:
#   snakemake --cores 72 --config \
#     genes_tsv=genes.tsv genome_fasta=/path/genome.fa \
#     locus_gff=/path/locus.gff transcripts_gff=/path/transcripts.gff \
#     fastq_dir=/path/fastq data_dir=public/data log_dir=logs \
#     upstream=5000 downstream=5000 all

def _need(key):
    if key not in config:
        raise ValueError(
            f"Missing required --config: {key}. "
            f"Use add_genes.sh or pass via: snakemake --config {key}=..."
        )
    return config[key]

GENES_TSV        = config.get("genes_tsv", "genes.tsv")
GENOME_FASTA     = _need("genome_fasta")
LOCUS_GFF        = _need("locus_gff")
TRANSCRIPTS_GFF  = _need("transcripts_gff")
FASTQ_DIR        = _need("fastq_dir")
DATA_DIR         = config.get("data_dir", "public/data")
LOG_DIR          = config.get("log_dir", "logs")
UPSTREAM         = int(config.get("upstream", 5000))
DOWNSTREAM       = int(config.get("downstream", 5000))
SCRIPTS_DIR      = "scripts"

# ─────────────────────────────────────────────────────────────────────────
# Load gene registry
# ─────────────────────────────────────────────────────────────────────────
def load_tsv(path):
    """genes.tsv → [{gene_id, group, symbol?, desc?}]

    TSV format (tab-separated):
        gene_id <TAB> group [<TAB> symbol [<TAB> description]]
    """
    if not os.path.exists(path):
        print(f"[Snakefile] WARN: {path} not found, no genes defined")
        return []
    entries = []
    header_seen = False
    with open(path) as f:
        for line in f:
            line = line.rstrip('\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            parts = line.split('\t')
            if not header_seen and parts[0].lower() == 'gene_id':
                header_seen = True
                continue
            header_seen = True
            if len(parts) < 2:
                continue
            entries.append({
                'gene_id': parts[0].strip(),
                'group':   parts[1].strip(),
                'symbol':  parts[2].strip() if len(parts) >= 3 else '',
                'desc':    parts[3].strip() if len(parts) >= 4 else '',
            })
    return entries

REGISTRY = load_tsv(GENES_TSV)
GENES    = [e['gene_id'] for e in REGISTRY]
GENE_GROUP = {e['gene_id']: e['group'] for e in REGISTRY}

# ─────────────────────────────────────────────────────────────────────────
# Discover samples from FASTQ dir
# ─────────────────────────────────────────────────────────────────────────
def discover_samples():
    if not os.path.isdir(FASTQ_DIR):
        print(f"[Snakefile] WARN: FASTQ_DIR {FASTQ_DIR} not found")
        return []
    pat = os.path.join(FASTQ_DIR, "*_R1_trimmed.fastq.gz")
    return sorted({
        os.path.basename(f).replace("_R1_trimmed.fastq.gz", "")
        for f in glob.glob(pat)
    })

SAMPLES = discover_samples()

print(f"[Snakefile] {len(GENES)} genes × {len(SAMPLES)} samples = {len(GENES)*len(SAMPLES)} BAMs")

# ─────────────────────────────────────────────────────────────────────────
# Helper: gene → file path
# ─────────────────────────────────────────────────────────────────────────
def gene_fa_path(gene_id):
    """Return per-gene reference FASTA path (with group prefix)."""
    grp = GENE_GROUP.get(gene_id, "Unknown")
    return f"{DATA_DIR}/{grp}/{gene_id}/{gene_id}.fa"

# ─────────────────────────────────────────────────────────────────────────
# Target: all
# ─────────────────────────────────────────────────────────────────────────
rule all:
    input:
        f"{DATA_DIR}/index.json",
        [f"{DATA_DIR}/precomputed/{g}.json" for g in GENES],

# ─────────────────────────────────────────────────────────────────────────
# Step 1: extract_regions
#   Single rule runs once for all genes in registry
# ─────────────────────────────────────────────────────────────────────────
rule extract_regions:
    """Per-gene region extraction — independent rule per gene so adding one
    new gene doesn't invalidate existing extracts."""
    input:
        genome      = ancient(GENOME_FASTA),
        locus       = ancient(LOCUS_GFF),
        transcripts = ancient(TRANSCRIPTS_GFF),
        tsv         = ancient(GENES_TSV),
    output:
        fa   = f"{DATA_DIR}/{{group}}/{{gene}}/{{gene}}.fa",
        gff  = f"{DATA_DIR}/{{group}}/{{gene}}/{{gene}}.local.gff3",
        meta = f"{DATA_DIR}/{{group}}/{{gene}}/{{gene}}.meta.json",
    params:
        upstream   = UPSTREAM,
        downstream = DOWNSTREAM,
        data_dir   = DATA_DIR,
    wildcard_constraints:
        gene = r"Os\d+g\d+"
    shell:
        r"""
        # per-gene temp TSV
        tmp_tsv=$(mktemp --suffix=.tsv)
        echo -e "{wildcards.gene}\t{wildcards.group}" > $tmp_tsv
        python {SCRIPTS_DIR}/extract_gene_regions_from_tsv.py \
            --genome {input.genome} \
            --locus {input.locus} \
            --transcripts {input.transcripts} \
            --gene-tsv $tmp_tsv \
            --upstream {params.upstream} \
            --downstream {params.downstream} \
            --data-dir {params.data_dir}
        rm -f $tmp_tsv
        """

# ─────────────────────────────────────────────────────────────────────────
# Step 2: bwa-mem2 index (per gene)
# ─────────────────────────────────────────────────────────────────────────
rule bwa_index:
    """Per-gene BWA-MEM2 index. Multiple index outputs are tracked via a
    single sentinel file to maintain wildcard consistency."""
    input:
        fa = lambda wc: gene_fa_path(wc.gene),
    output:
        sentinel = f"{LOG_DIR}/bwa_index/{{gene}}.done"
    log:
        f"{LOG_DIR}/bwa_index/{{gene}}.log"
    wildcard_constraints:
        gene = r"Os\d+g\d+"
    shell:
        r"""
        bwa-mem2 index "{input.fa}" 2> "{log}"
        samtools faidx "{input.fa}" 2>> "{log}"
        mkdir -p "$(dirname "{output.sentinel}")"
        touch "{output.sentinel}"
        """

# ─────────────────────────────────────────────────────────────────────────
# Step 3: map_bwa (per gene × sample)
# ─────────────────────────────────────────────────────────────────────────
rule map_bwa:
    input:
        fa    = lambda wc: gene_fa_path(wc.gene),
        idx   = f"{LOG_DIR}/bwa_index/{{gene}}.done",
        r1    = f"{FASTQ_DIR}/{{sample}}_R1_trimmed.fastq.gz",
        r2    = f"{FASTQ_DIR}/{{sample}}_R2_trimmed.fastq.gz",
    output:
        bam = f"{DATA_DIR}/bam/{{gene}}/{{sample}}.bam",
        bai = f"{DATA_DIR}/bam/{{gene}}/{{sample}}.bam.bai",
    threads: 12
    log:
        f"{LOG_DIR}/map_bwa/{{gene}}_{{sample}}.log"
    shell:
        r"""
        bwa-mem2 mem -t {threads} \
            -R "@RG\tID:{wildcards.sample}\tSM:{wildcards.sample}\tPL:ILLUMINA" \
            "{input.fa}" "{input.r1}" "{input.r2}" 2> "{log}" \
        | samtools view -F 4 -b 2>> "{log}" \
        | samtools sort -@ 4 -m 2G -o "{output.bam}" 2>> "{log}"
        samtools index "{output.bam}" 2>> "{log}"
        """

# ─────────────────────────────────────────────────────────────────────────
# Step 4: Initial index.json generation (required for pileup)
# ─────────────────────────────────────────────────────────────────────────
rule index_initial:
    """Initial index.json generation — uses meta.json only (not BAMs).
    Depends only on extract_regions outputs (meta.json per gene)."""
    input:
        metas = [gene_fa_path(g).replace('.fa', '.meta.json') for g in GENES],
        tsv   = ancient(GENES_TSV),
    output:
        f"{DATA_DIR}/index.json.initial"
    shell:
        """
        python {SCRIPTS_DIR}/generate_index.py --data-dir {DATA_DIR} --gene-tsv {input.tsv}
        cp {DATA_DIR}/index.json {output}
        """

# ─────────────────────────────────────────────────────────────────────────
# Step 5: pileup (per gene × sample)
# ─────────────────────────────────────────────────────────────────────────
rule pileup_single:
    input:
        bam   = f"{DATA_DIR}/bam/{{gene}}/{{sample}}.bam",
        bai   = f"{DATA_DIR}/bam/{{gene}}/{{sample}}.bam.bai",
        index = ancient(f"{DATA_DIR}/index.json.initial"),
    output:
        f"{DATA_DIR}/pileup/{{gene}}/{{sample}}.json"
    log:
        f"{LOG_DIR}/pileup/{{gene}}_{{sample}}.log"
    shell:
        """
        python {SCRIPTS_DIR}/generate_pileup.py \
            --gene {wildcards.gene} \
            --sample {wildcards.sample} \
            --data-dir {DATA_DIR} 2> {log}
        """

# ─────────────────────────────────────────────────────────────────────────
# Step 6: merge_pileup (per gene)
# ─────────────────────────────────────────────────────────────────────────
rule merge_pileup:
    """Generate per-gene all.json — reads only this gene's pileups and merges inline.
    (merge_pileup.py scans the whole directory; not used here.)"""
    input:
        pileups = lambda wc: [f"{DATA_DIR}/pileup/{wc.gene}/{s}.json" for s in SAMPLES]
    output:
        f"{DATA_DIR}/pileup/{{gene}}/all.json"
    run:
        import json, os
        merged = {}
        for p in input.pileups:
            sid = os.path.basename(p).replace('.json', '')
            with open(p) as f:
                data = json.load(f)
            merged[sid] = data.get('pileup', data)
        os.makedirs(os.path.dirname(output[0]), exist_ok=True)
        with open(output[0], 'w') as f:
            json.dump(merged, f)

# ─────────────────────────────────────────────────────────────────────────
# Step 6b: samples.json (per gene) — used by precompute.py and frontend
# ─────────────────────────────────────────────────────────────────────────
rule samples_json:
    """Generate per-gene sample list (samples.json). Required by precompute.py.
    Scans BAM files and saves the sample IDs as a JSON array."""
    input:
        bams = lambda wc: [f"{DATA_DIR}/bam/{wc.gene}/{s}.bam" for s in SAMPLES]
    output:
        f"{DATA_DIR}/bam/{{gene}}/samples.json"
    run:
        import json, os
        bam_dir = os.path.dirname(output[0])
        samples = sorted(
            f.replace('.bam', '')
            for f in os.listdir(bam_dir)
            if f.endswith('.bam') and not f.endswith('.bai') and 'tmp' not in f
        )
        with open(output[0], 'w') as f:
            json.dump(samples, f)

# ─────────────────────────────────────────────────────────────────────────
# Step 7: precompute (per gene)
# ─────────────────────────────────────────────────────────────────────────
rule precompute:
    input:
        merged  = f"{DATA_DIR}/pileup/{{gene}}/all.json",
        samples = f"{DATA_DIR}/bam/{{gene}}/samples.json",
        index   = ancient(f"{DATA_DIR}/index.json.initial"),
    output:
        f"{DATA_DIR}/precomputed/{{gene}}.json"
    threads: 12
    log:
        f"{LOG_DIR}/precompute/{{gene}}.log"
    shell:
        """
        python {SCRIPTS_DIR}/precompute.py \
            --gene {wildcards.gene} \
            --data-dir {DATA_DIR} \
            --jobs {threads} 2> {log}
        """

# ─────────────────────────────────────────────────────────────────────────
# Step 8: final index (updates samples.json references)
# ─────────────────────────────────────────────────────────────────────────
rule index:
    """Final index.json — includes samples.json references."""
    input:
        precomputes = [f"{DATA_DIR}/precomputed/{g}.json" for g in GENES],
        tsv         = ancient(GENES_TSV),
    output:
        f"{DATA_DIR}/index.json"
    shell:
        """
        python {SCRIPTS_DIR}/generate_index.py --data-dir {DATA_DIR} --gene-tsv {input.tsv}
        """
