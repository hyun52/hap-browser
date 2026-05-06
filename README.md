# HapBrowser

> **Rice haplotype browser with integrated marker design**
>
> Visualize gene-level haplotype patterns across 200+ rice accessions, design KASP / InDel markers in-browser, and add new genes via a one-command Snakemake pipeline.

[![License: Academic](https://img.shields.io/badge/license-Academic%20Non--Commercial-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](CHANGELOG_pipeline.md)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![Snakemake](https://img.shields.io/badge/Snakemake-9-039475.svg)](https://snakemake.github.io/)

<p align="center">
  <img src="docs/screenshots/main_view.png" alt="HapBrowser main view" width="900">
  <br>
  <em>Haplotype matrix view with 200 IRRI accessions across the Hd1 locus</em>
</p>

---

## Features

- ** Per-gene haplotype matrix** — Sample × variant grid for any RAP-DB gene, with SNP / InDel / Gap clustering
- ** Canvas-based rendering** — 60fps interaction with 200 samples × 10,000+ variant positions via virtual scrolling
- ** KASP & InDel marker design** — Allele-specific primers with Primer3-validated Tm / hairpin / dimer
- ** Variant-aware primer design** — Optionally avoid neighboring SNP/InDel sites in primer regions
- ** Phenotype overlay** — Upload phenotype CSV → automatic haplotype-level box plots
- ** Publication-ready export** — CSV matrices, Excel sheets, SVG box plots
- ** Reproducible pipeline** — Snakemake workflow: FASTQ → BAM → pileup → haplotype → browser, in one command

## Quick Start

### Run the browser (with included demo data)

```bash
git clone https://github.com/hyun52/hap-browser.git
cd hap-browser

# Install JS dependencies
npm install

# Install Python backend (KASP validation via Primer3)
pip install -r backend/requirements.txt

# Start frontend + backend
bash start.sh
# → Frontend: http://localhost:8080
# → Backend:  http://localhost:8081
```

The demo dataset includes 23 rice heading-date genes plus Sub1A across 200 IRRI accessions.

### Add a new gene

```bash
# Append to genes.tsv (tab-separated)
echo -e "Os07g0281400\tYield components\tDRO1" >> genes.tsv

# Run pipeline
./add_genes.sh \
    --tsv          genes.tsv \
    --genome       /path/to/IRGSP-1.0_genome.fasta \
    --locus        /path/to/locus.gff \
    --transcripts  /path/to/transcripts.gff \
    --fastq-dir    /path/to/fastq/trimmed \
    --data-dir     public/data \
    --log-dir      logs
```

≈ 30–45 min per new gene (200 samples, 72-core workstation).

**See [`USER_GUIDE_ADD_GENES.md`](USER_GUIDE_ADD_GENES.md) for a full walkthrough.**

---

## Screenshots

<table>
<tr>
<td align="center">
  <img src="docs/screenshots/genome_view.png" width="400"><br>
  <sub><b>Full Region View</b><br>JBrowse-style Canvas with zoom, pan, gene diagram</sub>
</td>
<td align="center">
  <img src="docs/screenshots/marker_design.png" width="400"><br>
  <sub><b>KASP Marker Design</b><br>Allele-specific primers with Primer3 validation</sub>
</td>
</tr>
<tr>
<td align="center">
  <img src="docs/screenshots/hapmatrix.png" width="400"><br>
  <sub><b>HapMatrix</b><br>Custom position table with phenotype box plots</sub>
</td>
<td align="center">
  <img src="docs/screenshots/blocking_variants.png" width="400"><br>
  <sub><b>Variant-aware diagnostics</b><br>Shows which neighboring variants block primer design</sub>
</td>
</tr>
</table>

> *Screenshots will be added in the GitHub release.*

---

## Architecture

```
┌─────────────────┐  Snakemake   ┌────────────────┐
│  FASTQ files    │ ───────────> │  per-gene BAM  │
│  (200 samples)  │  add_genes.sh│  pileup, JSON  │
└─────────────────┘              └────────┬───────┘
                                          │
                                          v
                  ┌────────────────────────────────────┐
                  │ React + Canvas Frontend (Vite)     │
                  │ - GenomeView (Canvas + virtual scroll)
                  │ - HapMatrix (custom position view)
                  │ - MarkerPanel (KASP / InDel design)
                  └─────────┬──────────────────────────┘
                            │
                            v
                  ┌────────────────────────┐
                  │ FastAPI Backend        │
                  │ - /api/primer3/validate│
                  │ - /api/blast           │
                  └────────────────────────┘
```

### Tech stack

- **Pipeline**: [Snakemake](https://snakemake.github.io/) 9, [BWA-MEM2](https://github.com/bwa-mem2/bwa-mem2), [samtools](https://www.htslib.org/), [pysam](https://pysam.readthedocs.io/)
- **Frontend**: React 18, Vite 5, Canvas (no Konva/etc.), OffscreenCanvas + Web Workers for performance
- **Backend**: FastAPI, [primer3-py](https://libnano.github.io/primer3-py/), Uvicorn
- **Marker design**: Custom KASP algorithm + Primer3 validation (SantaLucia 1998 nearest-neighbor Tm, [Mg²⁺] / [dNTP] correction)

## Requirements

| Component | Version |
|-----------|---------|
| Node.js   | 18+     |
| Python    | 3.10+   |
| Snakemake | 9.x     |
| BWA-MEM2  | 2.2.1+  |
| samtools  | 1.10+   |
| NCBI BLAST+ (optional) | 2.10+ |

Install pipeline tools via conda:
```bash
conda create -n hapbrowser -c bioconda -c conda-forge \
    snakemake bwa-mem2 samtools blast
conda activate hapbrowser
```

## Documentation

- [`USER_GUIDE_ADD_GENES.md`](USER_GUIDE_ADD_GENES.md) — Step-by-step gene addition
- [`README_pipeline.md`](README_pipeline.md) — Full pipeline reference
- [`CHANGELOG_pipeline.md`](CHANGELOG_pipeline.md) — Version history

## Demo Data

The included demo data covers:
- **23 rice heading-date genes** (Hd1, Ghd7, Ehd1, RFT1, OsMADS51, etc.)
- **1 flood-tolerance gene** (Sub1A)
- **200 IRRI accessions** from the 3K Rice Genomes Project

Note: BAM files are not included in the repository (~17 GB total). The browser still functions fully with the precomputed haplotype data. To regenerate BAMs, run the pipeline with your own copy of the FASTQ files.

## Contributing

This is an academic project under active development. Issues and pull requests are welcome:

- **Bug reports**: open an [issue](https://github.com/hyun52/hap-browser/issues) with the version and steps to reproduce
- **Feature requests**: open an issue describing the use case
- **Pull requests**: small, focused PRs preferred; please include a brief description

## License

This project is licensed under an **Academic Non-Commercial License**. See [`LICENSE`](LICENSE) for full terms.

- ✅ Free for academic and educational research
- ✅ Modification and redistribution allowed for academic use
- ❌ Commercial use prohibited without prior permission
- 📚 **Citation required** in publications

For commercial licensing inquiries, contact via GitHub.

## Citation

If you use HapBrowser in your research, please cite:

```bibtex
@software{hapbrowser2026,
  author       = {Lee, Hyunoh},
  title        = {HapBrowser: A Rice Haplotype Browser with Integrated Marker Design},
  year         = {2026},
  publisher    = {Plant Genome and Breeding Lab, Jeonbuk National University},
  url          = {https://github.com/hyun52/hap-browser},
  version      = {1.0.0}
}
```

Please also cite the underlying tools:
- **Snakemake**: Köster J. & Rahmann S. (2012). *Bioinformatics* 28(19):2520–2522.
- **BWA-MEM2**: Vasimuddin M. et al. (2019). *IPDPS* 314–324.
- **samtools / BCFtools**: Danecek P. et al. (2021). *GigaScience* 10(2).
- **Primer3**: Untergasser A. et al. (2012). *Nucleic Acids Res.* 40(15):e115.

## Acknowledgments

- **Reference data**: [RAP-DB](https://rapdb.dna.affrc.go.jp/) IRGSP-1.0
- **Sample data**: [IRRI 3K Rice Genomes Project](http://snp-seek.irri.org/)
- **PI**: Plant Genome and Breeding Lab, Jeonbuk National University

---

<p align="center">
  <sub>Built with 🌾 at PGBL Lab, JBNU</sub>
</p>
