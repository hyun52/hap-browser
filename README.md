# Hap-Browser

> **Haplotype browser with integrated marker design**
>
> Visualize gene-level haplotype patterns across 200 rice accessions, design KASP and InDel markers in-browser, and add new genes with a Snakemake pipeline.

[![License: Academic](https://img.shields.io/badge/license-Academic%20Non--Commercial-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](CHANGELOG_pipeline.md)
[![User Guide](https://img.shields.io/badge/📘_User_Guide-USER__GUIDE.md-028090.svg)](USER_GUIDE.md)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![Snakemake](https://img.shields.io/badge/Snakemake-9-039475.svg)](https://snakemake.github.io/)

<p align="center">
  <img src="docs/screenshots/main_view.png" alt="HapBrowser main view" width="900">
  <br>
  <em>Haplotype matrix for Hd1 across 200 IRRI accessions</em>
</p>

---

> ### 📘 [Read the User Guide](USER_GUIDE.md)
>
> Step-by-step walkthrough of every feature with screenshots — from selecting a gene to designing KASP markers and analyzing phenotype overlays across multiple genes.

---

## Features

- Per-gene haplotype matrix — sample × variant grid with SNP / InDel / Gap clustering
- KASP and InDel marker design with Primer3 validation
- Cross-gene haplotype analysis (HapMatrix) with phenotype overlay and box plots
- BLAST against per-sample consensus sequences
- Codon-level Protein View with AA-change detection
- CSV / TSV / SVG exports
- Snakemake pipeline to add new genes from FASTQ

## Quick Start

> **Prerequisite**: [Miniconda](https://docs.conda.io/en/latest/miniconda.html) installed. No sudo required.

```bash
# 1. Setup conda environment
conda create -n hapbrowser -c conda-forge -c bioconda python=3.11 nodejs blast -y
conda activate hapbrowser

# 2. Clone
git clone https://github.com/hyun52/hap-browser.git
cd hap-browser

# 3. Download pileup data (~773 MB) from the v1.0.0 release
wget https://github.com/hyun52/hap-browser/releases/download/v1.0.0/hap-browser-pileup-data-v1.0.0.tar.gz
tar xzf hap-browser-pileup-data-v1.0.0.tar.gz -C public/data/

# 4. Install dependencies
npm install
pip install -r backend/requirements.txt

# 5. Start
bash start.sh
# → Frontend: http://localhost:8080
# → Backend:  http://localhost:8081
```

The demo dataset includes 23 rice heading-date genes plus Sub1A across 200 IRRI accessions. See [`USER_GUIDE.md`](USER_GUIDE.md) for step-by-step usage.

## Adding new genes

The Quick Start above is enough for the demo data. To add new genes from your own FASTQ files, install the pipeline tools:

```bash
conda activate hapbrowser
conda install -c bioconda -c conda-forge snakemake bwa-mem2 samtools -y
```

Then follow [`USER_GUIDE_ADD_GENES.md`](USER_GUIDE_ADD_GENES.md).

| Pipeline tool | Version |
|---------------|---------|
| Snakemake | 9.x |
| BWA-MEM2  | 2.2.1+ |
| samtools  | 1.10+ |

## Screenshots

### Visualization

<table>
<tr>
<td align="center" width="50%">
  <img src="docs/screenshots/genome_view.png" width="450"><br>
  <sub><b>Genome view</b><br>Canvas matrix with zoom, pan, gene diagram</sub>
</td>
<td align="center" width="50%">
  <img src="docs/screenshots/protein_view.png" width="450"><br>
  <sub><b>Protein view</b><br>Codon-level overlay with AA-change detection</sub>
</td>
</tr>
</table>

### Marker Design & Search

<table>
<tr>
<td align="center" width="50%">
  <img src="docs/screenshots/marker_design.png" width="450"><br>
  <sub><b>KASP marker design</b><br>Allele-specific primers with Primer3 validation</sub>
</td>
<td align="center" width="50%">
  <img src="docs/screenshots/blast.png" width="450"><br>
  <sub><b>BLAST search</b><br>Sequence search across haplotype consensus</sub>
</td>
</tr>
</table>

### Multi-position Analysis

<p align="center">
  <img src="docs/screenshots/hapmatrix.png" width="700"><br>
  <sub><b>HapMatrix</b> — multi-gene position table with phenotype upload</sub>
</p>

## Architecture

FASTQ files go through the Snakemake pipeline to produce per-gene BAMs and pileup JSON. The React + Canvas frontend (GenomeView, HapMatrix, MarkerPanel) reads the JSON directly. A FastAPI backend handles Primer3 validation and BLAST.

```
FASTQ files  ──Snakemake──>  per-gene BAM, pileup JSON
                                        │
                                        v
                React + Canvas frontend (Vite)
                                        │
                                        v
                FastAPI backend (Primer3, BLAST)
```

### Tech stack

- **Pipeline**: [Snakemake 9](https://snakemake.github.io/), [BWA-MEM2](https://github.com/bwa-mem2/bwa-mem2), [samtools](https://www.htslib.org/), [pysam](https://pysam.readthedocs.io/)
- **Frontend**: React 18, Vite 5, Canvas, Web Workers
- **Backend**: FastAPI, [primer3-py](https://libnano.github.io/primer3-py/), Uvicorn

## Documentation

- [`USER_GUIDE.md`](USER_GUIDE.md) — Full feature walkthrough
- [`USER_GUIDE_ADD_GENES.md`](USER_GUIDE_ADD_GENES.md) — Adding new genes
- [`README_pipeline.md`](README_pipeline.md) — Pipeline reference
- [`CHANGELOG_pipeline.md`](CHANGELOG_pipeline.md) — Version history

## Demo Data

- 23 rice heading-date genes (Hd1, Ghd7, Ehd1, RFT1, OsMADS51, etc.)
- 1 flood-tolerance gene (Sub1A)
- 200 IRRI accessions from the 3K Rice Genomes Project

BAM files are not in the repository (~17 GB). The browser works fully with the precomputed haplotype data. To regenerate BAMs, run the pipeline with your own copy of the FASTQ files.

## Contributing

Issues and pull requests welcome.

- **Bug reports**: open an [issue](https://github.com/hyun52/hap-browser/issues) with the version and steps to reproduce
- **Feature requests**: open an issue describing the use case
- **Pull requests**: small, focused PRs preferred

## License

Licensed under an **Academic Non-Commercial License**. See [`LICENSE`](LICENSE) for full terms.

- Free for academic and educational research
- Modification and redistribution allowed for academic use
- Commercial use prohibited without prior permission
- Citation required in publications

For commercial licensing, contact via GitHub.

## Citation

> A peer-reviewed publication is in preparation. Until it is published, please cite this repository.

```bibtex
@software{hapbrowser2026,
  author    = {Lee, Hyunoh},
  title     = {HapBrowser: A Rice Haplotype Browser with Integrated Marker Design},
  year      = {2026},
  publisher = {Plant Genome and Breeding Lab, Jeonbuk National University},
  url       = {https://github.com/hyun52/hap-browser},
  version   = {1.0.0}
}
```

This page will be updated with the journal reference and DOI once published.

## Acknowledgments

- Reference data: [RAP-DB](https://rapdb.dna.affrc.go.jp/) IRGSP-1.0
- Sample data: [IRRI 3K Rice Genomes Project](http://snp-seek.irri.org/)
- Built on Snakemake, BWA-MEM2, samtools, and Primer3

---

<p align="center">
  <sub>PGBL Lab, JBNU</sub>
</p>
