#!/bin/bash
# add_genes.sh — HapBrowser gene addition pipeline (all-in-one)
# =============================================================
# Full pipeline in a single command:
#   TSV → extract → BWA index → map N samples
#       → pileup → merge → precompute → index.json
#
# Usage
# -----
#   ./add_genes.sh \
#       --tsv          genes.tsv \
#       --genome       /path/to/IRGSP-1.0_genome.fasta \
#       --locus        /path/to/locus.gff \
#       --transcripts  /path/to/transcripts.gff \
#       --fastq-dir    /data/holee/Pangenome_Nature_2025/fastq/trimmed \
#       --data-dir     /data/holee/hap-browser/hap-browser/public/data \
#       --log-dir      /data/holee/hap-browser/logs \
#       --upstream     5000 \
#       --downstream   5000 \
#       --cores        72
#
# Short options:
#   -t TSV          -g GENOME       -l LOCUS_GFF    -x TRANSCRIPTS_GFF
#   -f FASTQ_DIR    -d DATA_DIR     -L LOG_DIR
#   -u UPSTREAM     -D DOWNSTREAM   -j CORES
#
# Modes:
#   --dry-run (-n)    : Print execution plan only
#   --force   (-F)    : Regenerate all outputs
#   --report  FILE    : Pipeline HTML report (for paper supplementary)
#   --dag     FILE    : DAG diagram as SVG

set -euo pipefail

# ── Defaults ───────────────────────────────────────────────────────────
TSV=""
GENOME=""
LOCUS=""
TRANSCRIPTS=""
FASTQ_DIR=""
DATA_DIR="public/data"
LOG_DIR="logs"
UPSTREAM=5000
DOWNSTREAM=5000
CORES=$(nproc)
DRY_RUN=false
FORCE=false
REPORT=""
DAG=""
EXTRA_ARGS=()

usage() {
    sed -n 's/^# \?//p' "$0" | sed -n '2,35p'
    exit "${1:-0}"
}

# ── Argument parsing ───────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --tsv|-t)           TSV="$2"; shift 2 ;;
        --genome|-g)        GENOME="$2"; shift 2 ;;
        --locus|-l)         LOCUS="$2"; shift 2 ;;
        --transcripts|-x)   TRANSCRIPTS="$2"; shift 2 ;;
        --fastq-dir|-f)     FASTQ_DIR="$2"; shift 2 ;;
        --data-dir|-d)      DATA_DIR="$2"; shift 2 ;;
        --log-dir|-L)       LOG_DIR="$2"; shift 2 ;;
        --upstream|-u)      UPSTREAM="$2"; shift 2 ;;
        --downstream|-D)    DOWNSTREAM="$2"; shift 2 ;;
        --cores|-j)         CORES="$2"; shift 2 ;;
        --dry-run|-n)       DRY_RUN=true; shift ;;
        --force|-F)         FORCE=true; shift ;;
        --report)           REPORT="$2"; shift 2 ;;
        --dag)              DAG="$2"; shift 2 ;;
        --help|-h)          usage ;;
        -*)                 EXTRA_ARGS+=("$1"); shift ;;
        *)
            if [[ -z "$TSV" ]]; then TSV="$1"; shift
            else EXTRA_ARGS+=("$1"); shift
            fi ;;
    esac
done

# ── Required argument validation ───────────────────────────────────────
missing=()
[[ -z "$TSV"         ]] && missing+=("--tsv")
[[ -z "$GENOME"      ]] && missing+=("--genome")
[[ -z "$LOCUS"       ]] && missing+=("--locus")
[[ -z "$TRANSCRIPTS" ]] && missing+=("--transcripts")
[[ -z "$FASTQ_DIR"   ]] && missing+=("--fastq-dir")
if [[ ${#missing[@]} -gt 0 ]]; then
    echo "[ERROR] Missing required arguments: ${missing[*]}" >&2
    echo "Run --help for usage." >&2
    exit 2
fi

# ── File/directory existence checks ────────────────────────────────────
check_file() {
    if [[ ! -f "$1" ]]; then
        echo "[ERROR] File not found: $1 ($2)" >&2
        exit 1
    fi
}
check_dir() {
    if [[ ! -d "$1" ]]; then
        echo "[ERROR] Directory not found: $1 ($2)" >&2
        exit 1
    fi
}

check_file "$TSV"         "--tsv"
check_file "$GENOME"      "--genome"
check_file "$LOCUS"       "--locus"
check_file "$TRANSCRIPTS" "--transcripts"
check_dir  "$FASTQ_DIR"   "--fastq-dir"

[[ ! -f "Snakefile" ]] && {
    echo "[ERROR] Snakefile not found. Run from the hap-browser/ project root." >&2
    exit 1
}

# ── Tool availability check ────────────────────────────────────────────
for tool in snakemake bwa-mem2 samtools python3; do
    if ! command -v "$tool" &> /dev/null; then
        echo "[ERROR] Required tool not found: $tool" >&2
        exit 1
    fi
done

# ── Absolute paths + directory prep ────────────────────────────────────
TSV=$(realpath "$TSV")
GENOME=$(realpath "$GENOME")
LOCUS=$(realpath "$LOCUS")
TRANSCRIPTS=$(realpath "$TRANSCRIPTS")
FASTQ_DIR=$(realpath "$FASTQ_DIR")
mkdir -p "$DATA_DIR" "$LOG_DIR"
DATA_DIR=$(realpath "$DATA_DIR")
LOG_DIR=$(realpath "$LOG_DIR")

# ── Count genes ────────────────────────────────────────────────────────
N_GENES=$(awk -F'\t' '
    /^#/{next} /^[[:space:]]*$/{next}
    NR==1 && tolower($1)=="gene_id"{next}
    {n++} END{print n+0}
' "$TSV")

# ── Header ─────────────────────────────────────────────────────────────
echo "========================================"
echo "  HapBrowser Gene Addition Pipeline"
echo "========================================"
echo "  TSV:          $TSV"
echo "  Genes:        $N_GENES"
echo "  Genome:       $GENOME"
echo "  Locus GFF:    $LOCUS"
echo "  Transcripts:  $TRANSCRIPTS"
echo "  FASTQ dir:    $FASTQ_DIR"
echo "  Data dir:     $DATA_DIR"
echo "  Log dir:      $LOG_DIR"
echo "  Flanking:     -${UPSTREAM}bp / +${DOWNSTREAM}bp"
echo "  Cores:        $CORES / $(nproc) available"
[ "$DRY_RUN" = true ] && echo "  Mode:         DRY-RUN (no execution)"
[ "$FORCE"   = true ] && echo "  Mode:         FORCE (regenerate all)"
[ -n "$REPORT" ]      && echo "  Report:       $REPORT"
[ -n "$DAG" ]         && echo "  DAG:          $DAG"
echo "========================================"
echo ""

# ── Snakemake invocation ───────────────────────────────────────────────
SM_ARGS=(
    --snakefile Snakefile
    --cores "$CORES"
    --rerun-incomplete
    --keep-going
    --printshellcmds
    --rerun-triggers mtime
    --config
    "genes_tsv=$TSV"
    "genome_fasta=$GENOME"
    "locus_gff=$LOCUS"
    "transcripts_gff=$TRANSCRIPTS"
    "fastq_dir=$FASTQ_DIR"
    "data_dir=$DATA_DIR"
    "log_dir=$LOG_DIR"
    "upstream=$UPSTREAM"
    "downstream=$DOWNSTREAM"
)
[ "$DRY_RUN" = true ] && SM_ARGS+=( --dry-run )
[ "$FORCE"   = true ] && SM_ARGS+=( --forceall )

# DAG-only (no execution)
if [ -n "$DAG" ]; then
    mkdir -p "$(dirname "$DAG")"
    echo "[DAG] Generating $DAG..."
    snakemake all "${SM_ARGS[@]}" --dag | dot -Tsvg > "$DAG"
    echo "[DAG] Saved: $DAG"
    exit 0
fi

# Main execution
snakemake all "${SM_ARGS[@]}" "${EXTRA_ARGS[@]}"

# Report generation (only on success)
if [ "$DRY_RUN" = false ] && [ -n "$REPORT" ]; then
    mkdir -p "$(dirname "$REPORT")"
    echo ""
    echo "[REPORT] Generating $REPORT..."
    snakemake "${SM_ARGS[@]}" --report "$REPORT"
    echo "[REPORT] Saved: $REPORT"
fi

echo ""
echo "========================================"
echo "  ✓ Pipeline complete"
echo "========================================"
echo ""
echo "  Next steps:"
echo "    1) Restart HapBrowser backend if running:"
echo "         pkill -f 'backend/server.py' ; bash start.sh"
echo "    2) Refresh browser — new genes should appear"
echo ""
