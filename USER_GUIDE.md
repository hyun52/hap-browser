# HapBrowser User Guide

> Step-by-step usage of every panel and feature.

## Table of Contents

1. [Quick Tour](#1-quick-tour) — main interface overview
2. [Selecting a Gene](#2-selecting-a-gene)
3. [Reading the Genome View](#3-reading-the-genome-view)
4. [Haplotype Classification](#4-haplotype-classification)
5. [KASP Marker Design](#5-kasp-marker-design)
6. [InDel Marker Design](#6-indel-marker-design)
7. [Multi-position Analysis (HapMatrix)](#7-multi-position-analysis-hapmatrix)
8. [BLAST Haplotype Search](#8-blast-haplotype-search)
9. [Sample Variety Names](#9-sample-variety-names)
10. [Protein View](#10-protein-view)
11. [Exporting Data](#11-exporting-data)
12. [Keyboard Shortcuts](#12-keyboard-shortcuts)

---

## 1. Quick Tour

When you first open HapBrowser (http://localhost:8080) and select a gene, the interface is divided into **five main areas**:

<p align="center">
  <img src="docs/screenshots/main_view_annotated.png" width="900">
</p>

### ① Top Bar

The top bar contains the current gene info and primary action buttons.

- **Gene name + RAP-DB ID** (e.g., `Hd1 · Os06g0275000`): currently loaded gene
- **`☰ Genes`**: open gene navigator
- **`RAP-DB pos`** input + **`Go`**: jump to a specific genomic coordinate within the gene
- **Action buttons** (right side):
  - **`HapMatrix`** — multi-position haplotype analysis with phenotype overlay
  - **`Export`** — download CSV (Excel)
  - **`Protein`** — toggle codon-level (AA) overlay in the Genome View
  - **`BLAST`** — search a sequence against the haplotype database

### ② Sidebar

Lists genes available in the browser.

- **Recent**: recently viewed genes (up to 4)
- **Gene Navigator**: groups (e.g., `Heading date genes`, `Flood tolerance`) → expandable lists of every registered gene
- Click any gene to load it. The currently selected gene is highlighted.

### ③ Annotation

The annotation rows above the haplotype matrix:

- **Transcription**: 5'→3' direction marker
- **RAP-DB position**: genomic coordinates (click `→ Local` to switch to gene-relative coords)
- **Reference**: reference base (A / T / G / C) at each position
- **Alt sample**: number of samples carrying the alternative allele
- **Alt read**: percentage of reads supporting the alt call (averaged across alt samples)

### ④ Genome View (Haplotype matrix)

The main visualization. Each row is one sample (or a group of identical haplotypes); each column is one variant position.

**Colors**:
- 🟦 **Blue** = `A`
- 🟩 **Green** = `T`
- 🟧 **Orange** = `G`
- 🟥 **Red** = `C`
- **`·`** = identical to reference
- **Gap (`-`)** = deletion

**Haplotype groups**: samples sharing identical patterns are grouped under colored headers (`Haplotype 1`, `Haplotype 2`, ...). The number indicates the haplotype rank (most common first).

**Interactions**:

| Action | Shortcut |
|--------|----------|
| Scroll vertically (samples) | Mouse wheel |
| Scroll horizontally (positions) | Horizontal wheel |
| Navigate | Arrow keys (↑ ↓ ← →) |
| Select a single SNP for **KASP** marker design | **Shift + Click** on a column |
| Select a range for **InDel** marker design | **Shift + Drag** across columns |
| View haplotype details | Click a haplotype header |

See [Section 5](#5-kasp-marker-design) for KASP and [Section 6](#6-indel-marker-design) for InDel design details.

### ⑤ Control Panel

Filters and classification options.

- **Range**: which region defines a "haplotype"
  - `Gene` — full gene region
  - `CDS` — coding sequence only
  - `Custom` — manually selected positions
- **Mode**: which variant types to use for haplotype clustering
  - `SNP`, `InDel`, `Gap` — toggleable
- **View**: visible region in the matrix
  - `All` — full extracted region (gene ± 5 kb flanking)
  - `Gene` — gene region only
  - `CDS` — coding sequence only
- **Show**: row visibility filters
  - `Identical` — show samples with no variants
  - `SNP`, `InDel`, `Gap` — show samples with each variant type
- **Sample Filter**: `Select All` / `Deselect All` / `Representatives` (one sample per haplotype)
- **Haplotype list**: clickable color-coded list of all haplotypes with sample counts. Click to filter the matrix to just that haplotype.

---

## 2. Selecting a Gene

There are three ways to load a gene in HapBrowser.

### A. From the sidebar (most common)

<p align="center">
  <img src="docs/screenshots/sidebar.png" width="280">
</p>

The **Gene Navigator** on the left lists all registered genes, grouped by trait category.

- **Recent**: up to 4 most recently viewed genes (current session). Click `clear` to reset.
- **Gene Navigator**: full gene list, organized by group (e.g., `Heading date genes`, `Flood tolerance`). The number badge shows how many genes are in each group.
  - Click a group header to expand or collapse it
  - Click any gene name (e.g., `Hd1`) to load it
- The currently active gene is **highlighted in blue**
- The small arrow on the right of each gene (`→` or `←`) indicates strand orientation (+ or − strand)

### B. Jump to a genomic coordinate

<p align="center">
  <img src="docs/screenshots/rapdb_jump.png" width="500">
</p>

If you know the RAP-DB position of a SNP or feature you want to inspect:

1. Type the position into the **`RAP-DB pos`** input box at the top (e.g., `9336985`)
2. Click **`Go`** (or press Enter)
3. HapBrowser finds the gene containing this coordinate and loads it, scrolling the matrix to that position

This is useful when working from publications, GWAS results, or external databases that report specific genomic coordinates.

> **Note**: The coordinate must fall within one of the registered gene regions (gene body ± flanking). The current gene's range is shown to the right of the input (e.g., `chr06:9,331,376–9,343,569 (+) · 12.2kb`). If the position is outside any registered gene, an error message appears.

### C. Toggle the sidebar

Click the **`☰ Genes`** button in the top bar to collapse or expand the sidebar. Useful for getting more horizontal space when reading a wide haplotype matrix.

---

## 3. Reading the Genome View

The Genome View packs multiple layers of information above the haplotype matrix. This section explains how to read each one.

### Header and legends

<p align="center">
  <img src="docs/screenshots/annotation.png" width="900">
</p>

The top of the Genome View shows:

- **Gene info bar** (left): symbol, RAP-DB ID, group, and primary transcript ID — e.g., `Hd1 · Os06g0275000 · Heading date (Os06t0275000-01)`
- **Coordinate range** (right): `chr06:9,331,376–9,343,569 (+) · 12.2 kb` shows chromosome, genomic span, strand, and total length
- **Mode summary**: `CDS · IDENTICAL+SNP+INDEL+GAP · 1,188 bp` — current classification range, active variant types, and the number of bp in the displayed region
- **REGION legend**: color codes for `CDS`, `5'UTR`, `3'UTR`, `Intron`, `Upstream`, `Downstream`
- **BASE legend**: color codes for variant displays — `A` (blue), `T` (green), `G` (orange), `C` (red), `Gap`, `Ins col` (inserted column), `Density` (variant density bar)

### Variant density bar

The thin red/orange band at the top is a **variant density heatmap** across the entire region. 
Darker (red) = more variants in that window; lighter = fewer. Use this to quickly spot variant hotspots before zooming in.

### Gene track

Below the density bar, the gene track shows:

- **Boxes** = exons (CDS in dark green, UTRs in lighter colors)
- **Lines** = introns
- **Strand arrows** = direction (`→` for + strand, `←` for − strand)
- **Multiple tracks** = overlapping genes or antisense transcripts (e.g., `Os06g0274950 ←` runs antisense to Hd1)

### Annotation rows

Just above the haplotype matrix:

- **Transcription**: 5'→3' direction marker
- **RAP-DB position**: genomic coordinates of each visible column
  - Click **`→ Local`** to toggle between genomic and gene-relative (1-based from gene start) coordinates
- **Reference**: reference base (A / T / G / C) at each position, colored as in the BASE legend
- **Alt sample**: number of samples carrying any non-reference allele
- **Alt read**: average % of reads supporting the alt call across alt samples

> **Note**: Reading the haplotype matrix itself (cell colors, haplotype groups) is covered in [Section 1 Quick Tour ④](#-genome-view-haplotype-matrix). Controlling which region is visible is covered in [Section 4 Haplotype Classification](#4-haplotype-classification).

---
