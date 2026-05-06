# HapBrowser — Gene Addition Pipeline

Add new genes to HapBrowser in **one command, no config file needed**.

## Quick Start

```bash
./add_genes.sh \
    --tsv          genes.tsv \
    --genome       /path/to/IRGSP-1.0_genome.fasta \
    --locus        /path/to/locus.gff \
    --transcripts  /path/to/transcripts.gff \
    --fastq-dir    /path/to/fastq/trimmed \
    --data-dir     /path/to/hap-browser/public/data \
    --log-dir      /path/to/logs
```

Extract → BWA → pileup → haplotype → index, all in one run.
Re-run safe — existing files are skipped automatically.

## genes.tsv format

**Two columns minimum** (tab-separated):

```tsv
Os07g0281400	Yield components
Os09g0439200	Nutrient tolerance
```

Symbol/description auto-extracted from RAP-DB GFF `Note` field.

### When to use 3 or 4 columns

RAP-DB Note sometimes doesn't contain the well-known symbol (e.g.,
Sub1A is stored as "Pathogenesis-related transcriptional factor..."
in RAP-DB). If the auto-extracted symbol looks wrong in the browser,
add it explicitly:

```tsv
Os09g0286600	Flood tolerance	Sub1A	Submergence tolerance 1A
Os07g0281400	Yield components	DRO1	Deeper rooting 1
```

**Tip**: add as 2-column first, check the browser. If the symbol
looks wrong, edit TSV and re-run only the index step:
```bash
python scripts/generate_index.py --data-dir public/data --gene-tsv genes.tsv
```

## Required inputs

| Arg                 | Description                                  |
|---------------------|----------------------------------------------|
| `--tsv, -t`         | Gene registry (tab-separated)                |
| `--genome, -g`      | RAP-DB IRGSP-1.0 genome FASTA                |
| `--locus, -l`       | RAP-DB locus.gff                             |
| `--transcripts, -x` | RAP-DB transcripts.gff                       |
| `--fastq-dir, -f`   | FASTQ folder (`{sample}_R1_trimmed.fastq.gz`)|

## Optional

| Arg                | Default        | Description                    |
|--------------------|----------------|--------------------------------|
| `--data-dir, -d`   | `public/data`  | Output location                |
| `--log-dir, -L`    | `logs`         | Log file location              |
| `--upstream, -u`   | `5000`         | Upstream flanking (bp)         |
| `--downstream, -D` | `5000`         | Downstream flanking (bp)       |
| `--cores, -j`      | `nproc` output | CPU cores                      |

## Modes

| Flag              | Effect                                    |
|-------------------|-------------------------------------------|
| `--dry-run, -n`   | Show plan, do nothing                     |
| `--force, -F`     | Regenerate all outputs                    |
| `--report FILE`   | HTML pipeline report (Supp Methods)       |
| `--dag FILE`      | DAG diagram SVG                           |

## Typical workflow

### Adding a new QTL

```bash
# 1) Append to genes.tsv
echo -e "Os07g0281400\tYield components" >> genes.tsv

# 2) Dry-run to verify plan
./add_genes.sh --dry-run -t genes.tsv ... (same command)

# 3) Execute
./add_genes.sh -t genes.tsv ...
```

### Expected dry-run output for 1 new gene × 200 samples

```
Job stats:
job              count
---------------  -------
extract_regions  1
bwa_index        1
map_bwa          200
index_initial    1
pileup_single    200
samples_json     1
merge_pileup     1
precompute       1
index            1
all              1
total            408
```

If you see 4000+ jobs, something's wrong. See Troubleshooting.

## Requirements

```bash
pip install snakemake pysam primer3-py
# bwa-mem2, samtools must be in PATH
```

## Approximate runtime

For **1 new gene × 200 samples** on 72-core workstation:

| Step      | Time     |
|-----------|----------|
| extract   | < 1 min  |
| bwa_index | < 1 min  |
| map_bwa   | 30-45 min|
| pileup    | 3-5 min  |
| precompute| < 1 min  |
| **Total** | **~45 min** |

Scales roughly linearly — 10 new genes ≈ 7-8 hours.

## Migration and Troubleshooting

### Moving `public/data/` between servers

**Always use `cp -p` or `rsync -a`** to preserve timestamps. Plain
`cp -r` resets mtimes, making Snakemake think everything is new.

### First-time setup after migration from bare `cp -r`

```bash
cd hap-browser

# 1) Create bwa_index sentinel files
mkdir -p logs/bwa_index
for gene_dir in public/data/*/*/; do
    gene=$(basename "$gene_dir")
    if [[ "$gene" =~ ^Os[0-9]+g[0-9]+$ ]]; then
        touch "logs/bwa_index/${gene}.done"
    fi
done

# 2) Bootstrap index.json.initial from existing index.json
cp public/data/index.json public/data/index.json.initial

# 3) Set timestamps in DAG order (older → newer)
find public/data/*/*/*.fa -exec touch -d "10 minutes ago" {} +
find logs/bwa_index -name "*.done" -exec touch -d "9 minutes ago" {} +
find public/data/bam -type f -exec touch -d "8 minutes ago" {} +
touch -d "7 minutes ago" public/data/index.json.initial
find public/data/pileup -name "*.json" ! -name "all.json" -exec touch -d "6 minutes ago" {} +
find public/data/pileup -name "all.json" -exec touch -d "5 minutes ago" {} +
find public/data/precomputed -type f -exec touch -d "4 minutes ago" {} +
touch -d "1 minute ago" public/data/index.json

# 4) Dry-run
./add_genes.sh --dry-run ...
```

Target: "Nothing to be done" or a very small job count.

### Snakemake wants to re-run everything

The `--rerun-triggers mtime` flag (already in add_genes.sh) handles
common cases. If it still happens, check:

- **`genes.tsv` mtime newer than output files**: the Snakefile uses
  `ancient(GENES_TSV)` so this shouldn't trigger, but verify.
- **BAM timestamps newer than pileup**: re-touch in DAG order as above.

### "Lock" error from killed snakemake run

```bash
snakemake --snakefile Snakefile --unlock --config ... (same args)
```

### Paths with spaces

Fully supported in v89.24+. Group names like `"Heading date genes"`,
`"Flood tolerance"` work. All shell args are quoted internally.

## Reproducibility

Complete pipeline state is captured in:
- `Snakefile` — workflow DAG
- `genes.tsv` — gene registry
- The exact `add_genes.sh` command

For publication:
- Cite Snakemake (Köster 2012)
- Include `Snakefile` + `genes.tsv` + command in Supplementary
- Generate `--dag` SVG and `--report` HTML as Supplementary figures
