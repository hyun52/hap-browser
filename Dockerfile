# ─────────────────────────────────────────────
# HapBrowser v4.0 — All-in-one Docker Image
# ─────────────────────────────────────────────
# Build:   docker build -t hap-browser .
# Export:  docker save hap-browser -o hap-browser.tar
#
# On workstation (convert to Singularity):
#   singularity build hap-browser.sif docker-archive://hap-browser.tar
#
# Run modes:
#   # 1) Web server only (data already generated)
#   singularity run --bind /path/to/data:/data hap-browser.sif serve
#
#   # 2) Generate pileup data from BAMs
#   singularity run --bind /path/to/data:/data hap-browser.sif pipeline
#
#   # 3) Generate pileup for specific gene
#   singularity run --bind /path/to/data:/data hap-browser.sif pipeline --gene Os06g0275000
#
#   # 4) Rebuild index only
#   singularity run --bind /path/to/data:/data hap-browser.sif index
#
#   # 5) Interactive shell
#   singularity shell --bind /path/to/data:/data hap-browser.sif
# ─────────────────────────────────────────────

FROM node:20-slim AS builder

WORKDIR /app

# Install Node dependencies and build frontend
COPY package.json vite.config.js index.html ./
RUN npm install

COPY src/ src/
RUN npm run build

# ─── Final image ───
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=8080
ENV BLAST_PORT=8081
ENV DATA_DIR=/data
ENV LC_ALL=C.UTF-8

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    build-essential \
    samtools \
    ncbi-blast+ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Node.js (for serve)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g serve && \
    rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip3 install pysam snakemake && \
    pip3 install -r /app/backend/requirements.txt

# Copy built frontend
COPY --from=builder /app/dist /app/dist

# Copy backend, scripts, Snakefile
COPY backend/ /app/backend/
COPY scripts/ /app/scripts/
COPY Snakefile /app/Snakefile

# Entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

WORKDIR /app

EXPOSE 8080 8081

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["serve"]
