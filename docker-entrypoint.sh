#!/bin/bash
set -e

DATA_DIR="${DATA_DIR:-/data}"
PORT="${PORT:-8080}"
BLAST_PORT="${BLAST_PORT:-8081}"

show_banner() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  🌾  HapBrowser v4.0 (v76)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

case "${1:-serve}" in
    serve)
        show_banner
        echo "  Mode:      Web Server"
        echo "  Frontend:  http://0.0.0.0:${PORT}/"
        echo "  BLAST API: http://0.0.0.0:${BLAST_PORT}/api/blast"
        echo "  Data dir:  ${DATA_DIR}"
        echo "  Ctrl+C to stop"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        # Symlink data into dist/ so frontend can access it
        if [ -d "${DATA_DIR}" ] && [ ! -e "/app/dist/data" ]; then
            ln -sf "${DATA_DIR}" /app/dist/data
        fi

        # Start BLAST API in background
        python3 /app/backend/server.py --port "${BLAST_PORT}" --data-dir "${DATA_DIR}" &
        BLAST_PID=$!
        sleep 1

        # Start frontend server
        exec serve /app/dist -l "${PORT}" -s
        ;;

    pipeline)
        show_banner
        echo "  Mode:      Data Pipeline"
        echo "  Data dir:  ${DATA_DIR}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        shift
        GENE_ARG=""
        WORKERS="${PILEUP_WORKERS:-4}"

        while [[ $# -gt 0 ]]; do
            case "$1" in
                --gene) GENE_ARG="$2"; shift 2 ;;
                --workers) WORKERS="$2"; shift 2 ;;
                *) shift ;;
            esac
        done

        if [ -n "$GENE_ARG" ]; then
            echo ">> Generating pileup for gene: ${GENE_ARG} (${WORKERS} workers)"
            python3 /app/scripts/generate_pileup.py --gene "$GENE_ARG" --workers "$WORKERS" --data-dir "$DATA_DIR"
        else
            echo ">> Generating pileup for ALL genes (${WORKERS} workers)"
            python3 /app/scripts/generate_pileup.py --workers "$WORKERS" --data-dir "$DATA_DIR"
        fi

        echo ">> Generating index.json"
        cd "${DATA_DIR}/.." && python3 /app/scripts/generate_index.py

        echo ">> Done!"
        ;;

    index)
        show_banner
        echo "  Mode:      Rebuild index.json"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        cd "${DATA_DIR}/.." && python3 /app/scripts/generate_index.py
        echo ">> index.json updated"
        ;;

    blast-db)
        show_banner
        echo "  Mode:      Rebuild BLAST DB"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        python3 /app/backend/server.py --build-db-only --data-dir "${DATA_DIR}"
        echo ">> BLAST DB rebuilt"
        ;;

    shell|bash)
        exec /bin/bash
        ;;

    *)
        echo "Unknown command: $1"
        echo ""
        echo "Usage:"
        echo "  serve               Start web server (default)"
        echo "  pipeline            Generate all pileup data"
        echo "  pipeline --gene ID  Generate pileup for specific gene"
        echo "  index               Rebuild index.json"
        echo "  blast-db            Rebuild BLAST database"
        echo "  shell               Interactive shell"
        exit 1
        ;;
esac
