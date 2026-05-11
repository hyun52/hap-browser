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

## 4. Haplotype Classification

The Control Panel on the right governs **how samples are grouped into haplotypes** and **what is shown** in the matrix.

<p align="center">
  <img src="docs/screenshots/control_panel.png" width="320">
</p>

### Range — which region defines a haplotype

Determines the set of positions used to cluster samples.

| Option | Behavior |
|--------|----------|
| **Gene** | Use all variants within the gene body (UTRs + introns + CDS) |
| **CDS** | Use only variants within the coding sequence — fewer, biologically meaningful positions |
| **Custom** | Use only positions you specify manually (see below) |

### Mode — which variant types to use

Toggle which variant types contribute to haplotype clustering:

- **SNP** — single-base substitutions
- **InDel** — insertions and deletions
- **Gap** — gap regions (no mapping data)

Turning off `Gap`, for example, excludes samples differing only in coverage, leaving "true" haplotypes based on actual sequence differences.

### Custom Range — manually selected positions

<p align="center">
  <img src="docs/screenshots/range_custom.png" width="320">
</p>

To classify by a specific position or region of interest:

1. Click **`Custom`** under RANGE
2. Type a **RAP-DB position** in the `#1` `start` box (e.g., `9336660`)
3. Optionally enter an `end` position for a range; leave it empty for a single position
4. Click **`+ Add position`** to add up to 10 more independent positions/ranges
5. Click **`Reset`** to clear all entries
6. The matrix and haplotype list update instantly

> **Tip**: Single-position mode is useful when classifying by one focal SNP (e.g., a GWAS lead variant). For example, entering position `9336660` of Hd1 yields 3 haplotypes based on that single SNP (Ref G, Alt C, and reference samples).

### View — what is visible in the matrix

Independent of Range. Controls **only display**, not classification.

| Option | Visible columns |
|--------|----------------|
| **All** | Full extracted region (gene ± 5 kb flanking) |
| **Gene** | Gene body only |
| **CDS** | Coding sequence only |

> **Tip**: `View` and `Range` can be set independently. For example, `Range = CDS` (classify by coding variants) + `View = All` (but show the full region for context).

### Show — row visibility filters

Toggle which sample rows appear in the matrix:

- **Identical** — samples with no variants in the current Range (reference-like)
- **SNP / InDel / Gap** — samples carrying each variant type

Useful for focusing on, e.g., only samples with InDels, or hiding all reference-identical samples.

### Sample Filter — Representatives

<p align="center">
  <img src="docs/screenshots/representatives.png" width="900">
</p>

When working with many samples, **★ Representatives** shows just one sample per haplotype — the smallest non-redundant set.

- **Left**: full sample list (e.g., 200 samples, all rows shown)
- **Right**: after clicking `Representatives` — only one sample per haplotype remains, plus the haplotype list collapses to show only headers with sample counts

Useful for:
- Publication figures (cleaner matrix)
- Downstream sequence analysis (one representative per haplotype = unique sequences)

Use **`Select All`** / **`Deselect All`** to toggle every sample at once. Click individual sample rows to manually include/exclude them.

### Haplotype list

Color-coded list of all current haplotypes with their sample counts (shown as `n s` next to the name).

- The color circle matches the haplotype's color in the matrix
- Click a haplotype to filter the matrix to only those samples
- The summary line above (e.g., `185 haplotypes · 438 variants`) reflects current Range + Mode settings

---

## 5. KASP Marker Design

KASP (Kompetitive Allele Specific PCR) is a fluorescence-based SNP genotyping assay
widely used for marker-assisted selection in plant breeding. HapBrowser includes a
built-in KASP marker designer that takes any SNP from the genome view and produces
ready-to-order primer sets, complete with Primer3-based thermodynamic validation
and expected FAM/HEX sample clustering.

This section walks through the full KASP design workflow using a SNP in *Hd1*
(`Os06g0275000`) at position `9,338,330` as a running example.

---

### 5.1 Selecting a target SNP

To start a KASP design, **Shift+Click** the column header of the SNP you want to
target in the genome view. The column highlights and a toast notification at the
bottom shows the selected coordinate range. Releasing the Shift key opens the
Marker Design modal.

![Selecting a SNP with Shift+Click to open Marker Design](docs/screenshots/kasp_select_snp.png)

In the example above, the target SNP is `9,338,330 G→A` (RAP-DB coordinate) in the
*Hd1* CDS. The toast at the bottom confirms the selection:

```
⇔ 9,338,330 - 9,338,330  release → Marker Design
```

> **Tip:** You can also Shift+Click multiple columns to select a range. For KASP
> designs, only single-position selections are used — the SNP at the 3' end of the
> ASP defines the allele-specific discrimination. Multi-position ranges are
> intended for InDel marker design (see Section 6) or HapMatrix analysis
> (see Section 7).

---

### 5.2 Marker Design modal overview

Once the modal opens, you see two tabs at the top — **KASP (SNP)** and
**InDel Marker** — and the selected coordinate range in the top-right badge.
The modal starts in a collapsed state showing only the SNP position. Clicking
the SNP Position badge activates it, revealing FAM/HEX allele assignments and
the per-haplotype distribution.

![KASP Marker Design modal — initial state (left) and after SNP activation (right)](docs/screenshots/kasp_modal_overview.png)

**Modal anatomy:**

- **Tabs (top)** — Switch between `KASP (SNP)` and `InDel Marker` design modes.
- **Range badge (top-right)** — The selected genomic range, e.g. `9,338,330 - 9,338,330`.
- **SNP POSITION** — Lists all SNPs in the selected range. Click a position to
  activate it (badge turns blue).
- **FAM / HEX allele badges** — After activation, alleles are auto-assigned to
  the two KASP fluorescence channels.
- **Haplotype list** — Each haplotype's allele (`G`/`A` badge) and sample count
  (`n=`).
- **Design Options** (collapsible) — Tunable parameters for primer design
  (covered in Section 5.3).
- **Design Marker** (blue button) — Runs the design with current settings.

**FAM/HEX assignment convention:**

By default, HapBrowser assigns the **alternative allele to FAM** and the
**reference allele to HEX**:

- `FAM — Allele 1: A (Alt)` — the Alt allele (A) goes to the FAM channel.
- `HEX — Allele 2: G (Ref)` — the Ref allele (G) goes to the HEX channel.

This convention follows common breeding practice where the trait-associated or
rarer allele is reported on the FAM channel for easier downstream cluster
interpretation. You can manually swap the assignment in the exported primer
sequences if your KASP plate layout requires a different convention.

**Reading the haplotype distribution:**

Each row in the haplotype list shows which allele is carried by that haplotype,
along with the sample count. For example:

| Haplotype | Allele | n |
|-----------|--------|---|
| Haplotype 1 | G | 2 |
| Haplotype 2 | G | 1 |
| Haplotype 3 | A | 3 |
| Haplotype 4 | A | 1 |
| Haplotype 5 | A | 3 |
| ... | ... | ... |

This lets you preview the expected sample clustering before running the design.

---

### 5.3 Design Options

Click **Design Options ▼** to expand the parameter panel. All KASP design
parameters are tunable, but the defaults are calibrated for standard rice KASP
assays under typical reaction conditions.

![Design Options panel — all tunable parameters expanded](docs/screenshots/kasp_options.png)

**Top-level toggles:**

- **Auto-adjust params** — If no primer satisfies the current Tm/GC constraints,
  the designer automatically expands the search window. Useful for difficult
  regions; turn off for strict reproducibility.
- **Avoid neighboring variants** — Masks all other SNP/InDel sites in the primer
  binding region; primers cannot span any variant. Stricter (fewer candidates,
  higher specificity). This option is critical when designing markers for
  diverse panels — see Section 5.5 for troubleshooting.

**Length and composition:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| Amplicon (bp) | 50–150 | Total PCR product length |
| ASP length (bp) | 21–25 | Allele-specific primer length |
| CP length (bp) | 20–30 | Common primer length |
| Tm (°C) | 62–65 | Melting temperature window |
| GC (%) | 40–60 | GC content window |

**Differential and structural constraints:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| ASP Tm diff max (°C) | 0.5 | Maximum Tm difference between the two ASPs (FAM vs HEX) |
| ASP/CP Tm diff max (°C) | 3 | Maximum Tm difference between ASPs and Common Primer |
| Hairpin min stem (bp) | 4 | Minimum stem length to flag as a hairpin |
| Dimer min overlap (bp) | 4 | Minimum overlap to flag as a dimer |

> **Note:** The Tm targets here refer to the **built-in nearest-neighbor
> calculation** used during candidate generation. Primer3 validation
> (see Section 5.4) re-computes Tm under explicit reaction conditions
> (50 mM Na⁺, 1.5 mM Mg²⁺, 0.2 mM dNTP, 250 nM oligo) and may report values
> ~0.3°C higher. This difference is expected and harmless.

---

### 5.4 Successful design result

Click **Design Marker** to run the design. A successful result expands into
three sections: the primer table, the Primer3 validation panel, and the
expected sample groups. An **Export** button (top-right) downloads a
plain-text summary suitable for ordering and record-keeping.

![KASP design result — primer table (left, top), Primer3 validation (left, middle), Expected Sample Groups (left, bottom), and exported text file (right)](docs/screenshots/kasp_result.png)

#### Primer table

The primer table shows the three primers required for a KASP assay:

| Primer | Sequence (5'→3') | Tm | GC% | Length |
|--------|------------------|----|----|--------|
| `FAM ASP1 (A)` | `GAAGGTGACCAAGTTCATGCT-TCCACTGCAGCTCTATCTGACA` | 63.4 °C | 50% | 22 nt |
| `HEX ASP2 (G)` | `GAAGGTCGGAGTCAACGGATT-CCACTGCAGCTCTATCTGACG` | 63.1 °C | 57% | 21 nt |
| `CP (Common)` | `ACTACTCCCACTGGATCGATGT` | 63 °C | 50% | 22 nt |

The **gray prefix** on each ASP is the universal tail required for KASP
chemistry — `GAAGGTGACCAAGTTCATGCT` for FAM and `GAAGGTCGGAGTCAACGGATT` for HEX.
The **blue, bolded segment** is the allele-specific portion. The 3' terminal
base discriminates the SNP (A vs G in this example).

The chip row below the table summarizes structural QC:

- ✓ **Hairpin** — No internal secondary structure above threshold.
- ✓ **Self-dimer** — No problematic self-pairing.
- ✓ **Cross-dimer** — No primer-pair interaction above threshold.
- `ASP Tm diff: 0.3°C` — The two ASPs are well-matched in Tm.

#### Primer3 validation

The Primer3 validation panel re-computes thermodynamics using **Primer3
v2.3.0** under explicit KASP-like buffer conditions (50 mM Na⁺, 1.5 mM Mg²⁺,
0.2 mM dNTP, 250 nM oligo). This serves as an independent cross-check on the
built-in calculation.

| Primer | Tm (P3) | Tm (built-in) | Δ | Hairpin ΔG | Self-dimer ΔG |
|--------|---------|---------------|---|------------|---------------|
| ASP1 (22 nt) | 63.7 °C | 63.4 °C | +0.3 | 0.0 kcal/mol (Tm 37 °C) | −7.1 kcal/mol |
| ASP2 (21 nt) | 63.3 °C | 63.1 °C | +0.2 | 0.0 kcal/mol (Tm 37 °C) | −7.1 kcal/mol |
| CP (22 nt) | 63.2 °C | 63 °C | +0.2 | −0.3 kcal/mol (Tm 41 °C) | −5.7 kcal/mol |

**Cross-dimer ΔG:**

- `ASP1×ASP2: -7.1 kcal/mol` (orange — borderline)
- `ASP1×CP: -2.8 kcal/mol` (green — safe)
- `ASP2×CP: -2.8 kcal/mol` (green — safe)

**Color coding:**

| Color | Hairpin ΔG | Dimer ΔG | Interpretation |
|-------|------------|----------|----------------|
| 🟢 green | > −3 | > −6 | Safe |
| 🟠 orange | −3 to −6 | −6 to −9 | Caution — usually still works |
| 🔴 red | < −6 | < −9 | Risky — consider redesign |

> **Note:** ASP1×ASP2 cross-dimer is often slightly elevated in KASP designs
> because both ASPs share the same 3'-region (they differ only at the SNP base).
> A ΔG of −7 kcal/mol is within normal KASP operating range; values below
> −9 kcal/mol warrant redesign.

#### Expected Sample Groups

The bottom panel previews which samples should fall into the FAM and HEX
clusters based on the haplotype-allele assignments:

- **FAM Allele A** — 122 samples across Haplotypes 3, 4, 5, 6, ...
- **HEX Allele G** — 78 samples across Haplotypes 1, 2, 35, 36, 37, ...

Each group lists individual sample IDs (e.g., `ERS468475`, `ERS469118`) so you
can pre-select reference controls for the KASP plate.

#### Exported text file

Clicking **Export** downloads a plain-text file with all primer information,
formatted for easy copy-paste into ordering forms:

```
=== KASP Marker Design ===
Gene: Hd1 (Os06g0275000)
Position: 9,338,330 (RAP-DB)
Amplicon: 111 bp

[ASP1 — FAM] Allele A
  5'-GAAGGTGACCAAGTTCATGCT-[TCCACTGCAGCTCTATCTGACA]-3'
  Tm: 63.4°C  GC: 50%  Len: 22nt
[ASP2 — HEX] Allele G
  5'-GAAGGTCGGAGTCAACGGATT-[CCACTGCAGCTCTATCTGACG]-3'
  Tm: 63.1°C  GC: 57%  Len: 21nt
[CP] Common Primer
  5'-ACTACTCCCACTGGATCGATGT-3'
  Tm: 63°C  GC: 50%  Len: 22nt

--- Sample Groups ---
FAM (Allele A): 122 samples
  Haplotype 3      ERS468475
  Haplotype 3      ERS468646
  Haplotype 3      ERS468710
  ...
```

The square brackets `[...]` around the allele-specific portion of each ASP make
it easy to inspect or modify the discrimination region without re-typing the
universal tail. You can paste these sequences directly into KASP ordering forms
(LGC Biosearch, Standard BioTools, etc.) — most vendors accept the bracketed
notation or simply strip it.

---

### 5.5 Troubleshooting: blocking variants

When **Avoid neighboring variants** is turned on, the designer masks every
SNP/InDel position within the candidate primer-binding region. If no candidate
can avoid all nearby variants, the design fails with a detailed error message
explaining what blocked it.

![Failed KASP design with Avoid neighboring variants ON — error message and blocking variant visualization](docs/screenshots/kasp_blocking.png)

**Error anatomy:**

```
⚠ Cannot design Allele1 (A) ASP.
Reasons: 5 candidates blocked by nearby variants (masked)
Local sequence: GC=48%, Tm≈65.1°C
Suggestion: Nearby variants are masking primer sites — try a different SNP
```

Below the error, HapBrowser visualizes the primer-binding region with the
target SNP at the 3' end and color-coded annotations for blocking variants:

```
ASP binding region (5'→3'), 25 bp ending at target SNP:
                  ▼
  5' TTCTCCACTGCAGCTCT[T]ATCTGACG [SNP]
                       6947
  blue = SNP   orange = InDel   yellow = target SNP (3' end)
```

The blocking variant is then listed explicitly:

```
pos 9,338,322  (local 6947)  InDel +3bp  1 sample (rare)  [show varieties]
```

This tells you:

- **Where** the variant is (RAP-DB position and local coordinate within the gene)
- **What kind** (SNP or InDel, and the indel size if applicable)
- **How common** (sample count and a "rare" tag when n=1)
- **Who** carries it (click **show varieties** to expand the sample list)

**Decision guide:**

The tip line at the bottom of the error gives the key heuristic:

> *Tip: variants with n=1 may be sequencing artifacts. Disable "Avoid
> neighboring variants" if rare variants are acceptable.*

| Blocking variant profile | Recommended action |
|--------------------------|---------------------|
| `n=1` and labeled `rare` | Likely a sequencing artifact or singleton; disabling **Avoid neighboring variants** is usually safe |
| Low frequency (n=2–5) in panel outliers | Inspect via **show varieties**; if the carriers are not in your target germplasm, disable the option |
| Common variant (n>10) | Do not disable — primer will fail in a meaningful fraction of samples. Try a different target SNP, or shorten ASP length |
| Multiple blocking variants at different positions | Consider shifting to a nearby SNP, or use a longer amplicon to allow the designer more flexibility |

**Alternative strategies if redesign keeps failing:**

1. **Enable Auto-adjust params** — Lets the designer expand Tm/GC windows.
2. **Shorten the ASP length range** — e.g., 18–22 bp instead of 21–25 bp.
3. **Switch target SNP** — Re-open the genome view and select a different
   discriminating position in the same haplotype block.
4. **Switch to InDel Marker design** — If the haplotype is distinguished by a
   structural variant rather than a SNP, an InDel marker may be more robust
   (see Section 6).

> **Warning:** Disabling **Avoid neighboring variants** can produce primers
> that bind across rare variants. For most KASP applications this is
> acceptable, but if you plan to genotype a diverse panel that includes the
> rare variant carrier, expect occasional failed reactions for those samples.
> Always cross-check the **show varieties** list against your target
> germplasm before proceeding.

---

