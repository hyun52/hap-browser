#!/bin/bash
# update_samples.sh — auto-generate samples.json from BAM file list
# Usage: bash scripts/update_samples.sh [data_dir]
# Example: bash scripts/update_samples.sh public/data

DATA_DIR="${1:-public/data}"

echo "Scanning BAM directories in: $DATA_DIR/bam/"
echo ""

for d in "$DATA_DIR"/bam/Os*/; do
  if [ ! -d "$d" ]; then continue; fi
  gene=$(basename "$d")
  count=$(ls "$d"*.bam 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "  SKIP: $gene (no BAM files)"
    continue
  fi
  ls "$d"*.bam | xargs -n1 basename | sed 's/\.bam$//' | \
    python3 -c "import sys,json; print(json.dumps(sorted([l.strip() for l in sys.stdin if l.strip()])))" \
    > "$d/samples.json"
  n=$(python3 -c "import json; print(len(json.load(open('${d}samples.json'))))")
  echo "  OK: $gene — $n samples"
done

echo ""
echo "Done!"
