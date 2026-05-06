# CHANGELOG

## v89.24 (2026-04-21) — Pipeline hardening

Fixes from first real-world deployment testing. All changes validated
against a real 200-sample, 24-gene dataset running end-to-end on a
72-core workstation with one new gene added (Sub1A / Os09g0286600).

### add_genes.sh
- **FIX**: `check_file` / `check_dir` helper functions were using
  `[[ ... ]] && { ... exit 1; }` pattern which silent-exits the entire
  script under `set -euo pipefail` when the file exists. Rewrote as
  explicit `if [[ ... ]]; then ... fi` blocks.
- **ADD**: `--rerun-triggers mtime` flag passed to Snakemake by default.
  Prevents Snakemake 9.x from re-running all jobs when `genes.tsv`
  is edited.
- **FIX**: CLI argument order when calling Snakemake. Snakemake 9.x
  parses positional args after `--config` as config entries, so
  target `all` must come *before* `--config`. Changed
  `snakemake "${SM_ARGS[@]}" all` → `snakemake all "${SM_ARGS[@]}"`.

### Snakefile — DAG and correctness
- **CHANGE**: `extract_regions` is now a per-gene rule (parameterized
  by `{group}` and `{gene}` wildcards). Previously it was a single
  rule that extracted all genes at once; adding one new gene would
  make all output files "new" and trigger full DAG re-run.
- **ADD**: `ancient()` wrapping on `GENES_TSV` (3 locations) and on
  `index.json.initial` consumer rules (`pileup_single`, `precompute`).
  Prevents downstream cascade re-runs when these files are touched.
- **CHANGE**: `index_initial` rule no longer takes BAM files as input.
  Now depends only on per-gene `meta.json` files, so adding a new gene's
  BAMs doesn't force regeneration of `index.json.initial`.
- **NEW RULE**: `samples_json` — per-gene `bam/{gene}/samples.json`
  file is now generated automatically as a Snakemake rule. `precompute.py`
  requires this file; in v89.23 it was created by `generate_index.py`
  as a side-effect, which could miss new genes. Now it's a first-class
  DAG output, wired as input to `precompute`.

### Snakefile — Shell-safety for path-containing arguments
- **FIX**: All shell command arguments containing `{input.fa}`, `{output}`,
  `{log}` are now quoted with `"..."`. Group names with spaces
  (e.g. `"Heading date genes"`, `"Flood tolerance"`) previously broke
  BWA-MEM2 / samtools. Applied to `bwa_index` and `map_bwa` rules.

### Snakefile — Performance
- **CHANGE**: Default `threads: 2 → 12` for `map_bwa` and `precompute`.
  On 72 cores this runs 6 BWA jobs concurrently at 12 threads each —
  better CPU utilization than 36 jobs at 2 threads, which were mostly
  I/O-waiting.
- **CHANGE**: `samtools sort -@ 2 → -@ 4` for map_bwa pipeline.

### scripts/extract_gene_regions_from_tsv.py
- **FIX**: Destination directory collision handling. When Snakemake
  pre-creates the output directory, the script was refusing to move
  the extracted files into it ("exists, skip move"). Now: if the
  existing directory is empty, it's removed and the move proceeds.
  Non-empty directories still skip.

### Tested workflows
1. Pipeline bootstrap from existing 23-gene `public/data/` migrated
   with `cp -r` (needed timestamp reconstruction via `find -touch`).
2. Adding one new gene (Os09g0286600 Sub1A) to a different group
   (Flood tolerance) — full end-to-end in ~45 min on 72-core system.
3. Symbol override via 3-column TSV for genes whose RAP-DB Note
   doesn't contain a short symbol (Sub1A, DRO1, etc.).

### Upgrade path from v89.23

Replace these files:
```
add_genes.sh
Snakefile
scripts/extract_gene_regions_from_tsv.py
```

No data regeneration needed — existing `public/data/` is compatible.
First run may be slow as Snakemake rebuilds metadata; subsequent
runs are idempotent.

## v89.23 (2026-04-21) — Initial pipeline release

First release of the Snakemake-based gene addition pipeline.
