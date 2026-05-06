# User Guide — Adding New Genes to HapBrowser

This guide walks you through everything needed to add new rice genes to
your HapBrowser instance, from scratch. Intended for end users — no
knowledge of the internal pipeline is required.

---

## Overview

HapBrowser stores, per gene:
1. A region FASTA (gene ± flanking) and its GFF annotation
2. One BAM per sample, mapped to that region
3. A per-gene pileup JSON
4. A precomputed haplotype JSON
5. An entry in `public/data/index.json` that the browser reads

Adding a new gene means producing all of these artifacts. The
`add_genes.sh` script automates the entire pipeline — you edit one TSV
file and run one command.

---

## What You Need Before Starting

### 1. A running HapBrowser installation

You should already have HapBrowser v1.0.0 deployed on a server or
workstation with existing data (the 23 heading-date genes that ship
with v1.0.0, for example).

**Check it works first:**
```bash
cd /path/to/hap-browser
bash start.sh
# Open browser → existing genes load correctly
```

### 2. Reference genome and annotations (RAP-DB IRGSP-1.0)

You need these three files somewhere on disk:

| File                        | Source                                                       |
|-----------------------------|--------------------------------------------------------------|
| `IRGSP-1.0_genome.fasta`    | RAP-DB genome FASTA                                          |
| `locus.gff`                 | RAP-DB gene-level GFF                                        |
| `transcripts.gff`           | RAP-DB transcript-level GFF                                  |

If you already ran the pipeline once, you have these. Otherwise download
from https://rapdb.dna.affrc.go.jp/ and place in a directory of your
choice (e.g. `/data/genomes/IRGSP-1.0/`).

### 3. FASTQ files for your samples

Paired-end FASTQ files, trimmed, in a single directory. Filenames must
follow this pattern exactly:

```
{sample_id}_R1_trimmed.fastq.gz
{sample_id}_R2_trimmed.fastq.gz
```

Example:
```
/data/fastq/trimmed/
    ERS467761_R1_trimmed.fastq.gz
    ERS467761_R2_trimmed.fastq.gz
    ERS467762_R1_trimmed.fastq.gz
    ...
```

If your FASTQ filenames differ, either rename them (or symlink) or edit
the Snakefile accordingly.

### 4. Required software

```bash
# Python tools (via pip or conda)
pip install snakemake pysam primer3-py

# Plus: bwa-mem2, samtools in $PATH (via conda, apt, etc.)
bwa-mem2 version   # should work
samtools --version # should work
```

---

## Step-by-Step: Adding One Gene

Suppose you want to add **Sub1A** (submergence tolerance, Os09g0286600)
as an example.

### Step 1 — Find the RAP-DB gene ID

Look up your gene at https://rapdb.dna.affrc.go.jp/ and note the
`Os##g######` ID. For Sub1A it is `Os09g0286600`.

### Step 2 — Decide on a group name

Groups become folders under `public/data/` and sidebar sections in the
browser. You can use an existing group ("Heading date genes") or
create a new one ("Flood tolerance", "Yield components", etc.).

Group names may contain spaces — the pipeline handles them safely.

### Step 3 — Edit `genes.tsv`

Open the `genes.tsv` file in the project root. The format is
tab-separated with 2 to 4 columns:

```
gene_id        group              symbol (optional)  description (optional)
Os09g0286600   Flood tolerance    Sub1A              Submergence tolerance 1A
```

**Minimum 2 columns** is enough — symbol and description will be
auto-extracted from the RAP-DB GFF Note field.

**Add your gene at the end:**

```bash
echo -e "Os09g0286600\tFlood tolerance\tSub1A" >> genes.tsv
```

Verify:
```bash
tail -3 genes.tsv
```

### Step 4 — Dry run to preview the plan

Always preview before actually running:

```bash
./add_genes.sh --dry-run \
    --tsv          genes.tsv \
    --genome       /data/genomes/IRGSP-1.0/IRGSP-1.0_genome.fasta \
    --locus        /data/genomes/IRGSP-1.0/locus.gff \
    --transcripts  /data/genomes/IRGSP-1.0/transcripts.gff \
    --fastq-dir    /data/fastq/trimmed \
    --data-dir     public/data \
    --log-dir      logs
```

**Expected output** (example for 1 new gene, 200 samples):
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

Only the new gene's jobs are scheduled. If you see **4000+ jobs**,
something is wrong with file timestamps — see Troubleshooting below.

### Step 5 — Run the actual pipeline

Remove `--dry-run` and execute:

```bash
./add_genes.sh \
    --tsv          genes.tsv \
    --genome       /data/genomes/IRGSP-1.0/IRGSP-1.0_genome.fasta \
    --locus        /data/genomes/IRGSP-1.0/locus.gff \
    --transcripts  /data/genomes/IRGSP-1.0/transcripts.gff \
    --fastq-dir    /data/fastq/trimmed \
    --data-dir     public/data \
    --log-dir      logs
```

**Runtime**: ~30–45 min for 1 new gene × 200 samples on a 72-core
workstation.

To run in the background and disconnect:

```bash
nohup ./add_genes.sh [args] > pipeline.log 2>&1 &
disown
tail -f pipeline.log
```

### Step 6 — Monitor progress (optional)

In another terminal:

```bash
# Count BAMs produced so far (target: 200)
ls /path/to/public/data/bam/Os09g0286600/*.bam 2>/dev/null | wc -l

# Count active BWA/samtools processes
ps -ef | grep -E "bwa-mem2|samtools" | grep -v grep | wc -l
```

### Step 7 — Verify in the browser

Once the pipeline finishes:

```bash
# If the backend server was already running, restart it so it picks up
# the new data
pkill -f "backend/server.py"
bash start.sh
```

Open the browser and refresh (Cmd+Shift+R / Ctrl+Shift+R). You should see:

- The new group name in the sidebar (e.g. "Flood tolerance")
- Your gene entry (e.g. "Sub1A")
- Clicking it loads the haplotype view with 200 samples

### Step 8 — Fix the displayed name if needed

If the auto-extracted symbol looks wrong (e.g. RAP-DB's Note doesn't
contain a clean symbol), override it in `genes.tsv`:

```tsv
Os09g0286600	Flood tolerance	Sub1A	Submergence tolerance 1A
```

Then regenerate just the index (no need to rerun the whole pipeline):

```bash
python scripts/generate_index.py --data-dir public/data --gene-tsv genes.tsv
```

Refresh the browser. Done.

---

## Adding Multiple Genes at Once

Batch-add genes the same way. Each extra gene adds ~30–45 min.

```bash
# Edit genes.tsv — append all new entries
cat >> genes.tsv << 'EOF'
Os07g0281400	Yield components	DRO1
Os09g0439200	Nutrient tolerance	PSTOL1
Os01g0963600	Disease resistance	Pid3
EOF

# Same command as before — pipeline automatically processes only new genes
./add_genes.sh [same args]
```

For batches of 10+ genes, run overnight with `nohup`.

---

## Troubleshooting

### Dry-run shows too many jobs (thousands instead of ~400)

This happens when file timestamps are inconsistent (e.g. after copying
the `public/data` folder with `cp -r` instead of `cp -p`). Snakemake
thinks existing data is "new" and wants to regenerate everything.

**Fix**: set timestamps in DAG order (older → newer):

```bash
cd /path/to/hap-browser

find public/data/*/*/*.fa -exec touch -d "10 minutes ago" {} +
find logs/bwa_index -name "*.done" -exec touch -d "9 minutes ago" {} +
find public/data/bam -type f -exec touch -d "8 minutes ago" {} +
touch -d "7 minutes ago" public/data/index.json.initial
find public/data/pileup -name "*.json" ! -name "all.json" -exec touch -d "6 minutes ago" {} +
find public/data/pileup -name "all.json" -exec touch -d "5 minutes ago" {} +
find public/data/precomputed -type f -exec touch -d "4 minutes ago" {} +
touch -d "1 minute ago" public/data/index.json
```

Then re-run `--dry-run` — job count should drop to the expected number.

### "bwa_index sentinel files not found"

Only happens on fresh installs where `logs/bwa_index/` was never
populated. Create sentinels for already-indexed genes:

```bash
mkdir -p logs/bwa_index
for gene_dir in public/data/*/*/; do
    gene=$(basename "$gene_dir")
    if [[ "$gene" =~ ^Os[0-9]+g[0-9]+$ ]]; then
        touch "logs/bwa_index/${gene}.done"
    fi
done
cp public/data/index.json public/data/index.json.initial
```

### "Directory cannot be locked"

Snakemake crashed previously and left a lock file. Clear it:

```bash
snakemake --snakefile Snakefile --unlock --config \
    genes_tsv=genes.tsv \
    genome_fasta=/path/to/IRGSP-1.0_genome.fasta \
    locus_gff=/path/to/locus.gff \
    transcripts_gff=/path/to/transcripts.gff \
    fastq_dir=/path/to/fastq/trimmed \
    data_dir=public/data log_dir=logs \
    upstream=5000 downstream=5000
```

### "BWA-MEM2 fails: No such file or directory"

Usually indicates your group name contains characters that break shell
commands. v1.0.0 handles spaces correctly (quoted paths); if you use
other special characters (`$`, `!`, quotes), rename the group.

### New gene doesn't appear in the browser

1. Refresh hard (Cmd+Shift+R)
2. Verify `index.json` was updated:
   ```bash
   grep "Os09g0286600" public/data/index.json
   ```
3. If missing, regenerate:
   ```bash
   python scripts/generate_index.py --data-dir public/data --gene-tsv genes.tsv
   ```

### Wrong symbol displayed (e.g. gene ID instead of Sub1A)

Some RAP-DB Note fields don't contain a clean symbol. Override in
`genes.tsv` (column 3) and run `generate_index.py` again — see Step 8.

### Pipeline is too slow

Default is 12 threads per BWA job, running ~6 jobs in parallel on a
72-core system. If your machine has fewer cores, reduce threads:

Edit `Snakefile` and change `threads: 12` to a lower value (e.g. `threads: 4`),
then rerun.

---

## What NOT to Do

- **Don't edit files under `public/data/*/{gene}/`** by hand. Let the
  pipeline manage these.
- **Don't modify `index.json` manually** — regenerate it with
  `scripts/generate_index.py`.
- **Don't copy `public/data/` with plain `cp -r`**. Use `cp -p` or
  `rsync -a` to preserve mtimes, otherwise the pipeline will want to
  reprocess everything.
- **Don't run `add_genes.sh` from a different working directory**.
  Always `cd` into the project root first.

---

## Getting Help

- `README_pipeline.md` — full pipeline reference
- `CHANGELOG_pipeline.md` — known issues and fixes per version
- Check `logs/` for detailed per-step error messages
- Snakemake log: `.snakemake/log/*.log` contains the most recent run

---

## Summary — The Essential Commands

```bash
# 1. Edit the gene list
echo -e "Os09g0286600\tFlood tolerance\tSub1A" >> genes.tsv

# 2. Preview
./add_genes.sh --dry-run --tsv genes.tsv \
    --genome /path/IRGSP-1.0_genome.fasta \
    --locus /path/locus.gff --transcripts /path/transcripts.gff \
    --fastq-dir /path/fastq/trimmed \
    --data-dir public/data --log-dir logs

# 3. Run for real (same command, without --dry-run)
./add_genes.sh --tsv genes.tsv \
    --genome /path/IRGSP-1.0_genome.fasta \
    --locus /path/locus.gff --transcripts /path/transcripts.gff \
    --fastq-dir /path/fastq/trimmed \
    --data-dir public/data --log-dir logs

# 4. Refresh browser
```

That's it. Total elapsed time for one new gene: ~30–45 min.
