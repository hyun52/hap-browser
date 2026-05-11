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

Open HapBrowser at <http://localhost:8080> and pick a gene from the sidebar.
The interface splits into five areas:

[![](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/main_view_annotated.png)](/hyun52/hap-browser/blob/main/docs/screenshots/main_view_annotated.png)

### ① Top Bar

Gene info and primary actions.

- **Gene name + RAP-DB ID** (e.g., `Hd1 · Os06g0275000`)
- **`☰ Genes`** — toggle sidebar
- **`RAP-DB pos`** input + **`Go`** — jump to a coordinate
- Right side: **`HapMatrix`**, **`Export`**, **`Protein`**, **`BLAST`**, and the
  🏷 tag icon for sample variety mapping

### ② Sidebar

Gene navigator on the left.

- **Recent** — recently viewed genes (up to 4)
- **Gene Navigator** — groups like `Heading date genes`, `Flood tolerance`,
  expandable lists of every registered gene
- Click a gene to load it. Active gene is highlighted.

### ③ Annotation

Rows directly above the matrix:

- **Transcription** — 5'→3' direction marker
- **RAP-DB position** — genomic coordinates (click `→ Local` for
  gene-relative coords)
- **Reference** — reference base (A/T/G/C)
- **Alt sample** — number of samples with the alternative allele
- **Alt read** — % of reads supporting the alt call

### ④ Genome View

The main visualization. Rows are samples (grouped by identical haplotype),
columns are variant positions.

Colors: 🟦 A · 🟩 T · 🟧 G · 🟥 C · `·` reference · `-` gap.

Samples with the same pattern are grouped under colored `Haplotype N`
headers (Haplotype 1 = most common).

Interactions:

| Action | How |
| --- | --- |
| Scroll samples / positions | Mouse wheel / horizontal wheel |
| Navigate | Arrow keys |
| Select a SNP (KASP) | **Shift + Click** |
| Select a range (InDel) | **Shift + Drag** |
| Haplotype details | Click a haplotype header |

### ⑤ Control Panel

Filters and classification.

- **Range** — region that defines a haplotype: `Gene` / `CDS` / `Custom`
- **Mode** — which variant types cluster samples: `SNP` / `InDel` / `Gap`
- **View** — which columns are visible: `All` / `Gene` / `CDS`
- **Show** — row filters: `Identical` / `SNP` / `InDel` / `Gap`
- **Sample Filter** — `Select All` / `Deselect All` / `Representatives`
  (one sample per haplotype)
- **Haplotype list** — clickable, color-coded, with sample counts

---

## 2. Selecting a Gene

Three ways to load a gene.

### A. From the sidebar

[![](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/sidebar.png)](/hyun52/hap-browser/blob/main/docs/screenshots/sidebar.png)

Genes are grouped by trait category. The number badge shows how many
genes are in each group. Click a group header to expand or collapse, then
click a gene name to load it. The active gene is highlighted in blue.
The small `→` or `←` arrow next to each gene indicates strand.

**Recent** shows the last 4 genes viewed in the current session; click
`clear` to reset.

### B. Jump to a coordinate

[![](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/rapdb_jump.png)](/hyun52/hap-browser/blob/main/docs/screenshots/rapdb_jump.png)

Type a RAP-DB position into the input at the top, hit Enter (or click
`Go`). HapBrowser finds the gene containing the coordinate, loads it, and
scrolls to that position. The coordinate must fall inside one of the
registered gene regions; otherwise an error appears.

### C. Toggle the sidebar

`☰ Genes` collapses or expands the sidebar. Useful for more horizontal
space when reading a wide matrix.

---

## 3. Reading the Genome View

The Genome View packs several layers of information.

### Header and legends

[![](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/annotation.png)](/hyun52/hap-browser/blob/main/docs/screenshots/annotation.png)

Top row: gene symbol, RAP-DB ID, transcript ID, coordinate range, and
strand. Below that, a one-line mode summary like
`CDS · IDENTICAL+SNP+INDEL+GAP · 1,188 bp` reflects the current Control
Panel settings.

Legends:

- **REGION** — `CDS`, `5'UTR`, `3'UTR`, `Intron`, `Upstream`, `Downstream`
- **BASE** — A (blue), T (green), G (orange), C (red), Gap, Ins col, Density

### Variant density bar

The thin red/orange band at the top is a variant density heatmap across
the entire region. Darker = more variants. Useful for spotting hotspots
before zooming in.

### Gene track

Boxes are exons (CDS in dark green, UTRs in lighter colors). Lines are
introns. Multiple tracks indicate overlapping or antisense transcripts —
e.g., `Os06g0274950 ←` runs antisense to *Hd1*.

### Annotation rows

Just above the matrix:

- **Transcription** — 5'→3' marker
- **RAP-DB position** — genomic coords; click `→ Local` to switch to
  gene-relative
- **Reference** — reference base, BASE-legend colored
- **Alt sample** — number of samples with any non-reference allele
- **Alt read** — average % of reads supporting alt across those samples

---

## 4. Haplotype Classification

The Control Panel governs how samples are grouped and what is shown.

[![](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/control_panel.png)](/hyun52/hap-browser/blob/main/docs/screenshots/control_panel.png)

### Range

Which positions define a haplotype:

| Option | Behavior |
| --- | --- |
| **Gene** | All variants in the gene body |
| **CDS** | Coding sequence only |
| **Custom** | Manually selected positions (see below) |

### Mode

Which variant types contribute to clustering. Toggle `SNP`, `InDel`, `Gap`
independently. Disabling `Gap`, for example, excludes samples that differ
only in coverage.

### Custom Range

[![](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/range_custom.png)](/hyun52/hap-browser/blob/main/docs/screenshots/range_custom.png)

Click `Custom`, type a RAP-DB position in the `start` box (and optionally
`end` for a range), and click `+ Add position` to add more. The matrix
and haplotype list update on each change. `Reset` clears all entries.

Single-position custom range is useful for classifying by one focal SNP —
e.g., position `9336660` in *Hd1* yields 3 haplotypes based on that SNP
alone.

### View

What's visible in the matrix, independent of Range:

- **All** — full extracted region (gene ± 5 kb flanking)
- **Gene** — gene body only
- **CDS** — coding sequence only

You can set Range = `CDS` (classify by coding variants) and View = `All`
(but show the full region) at the same time.

### Show

Row filters: `Identical`, `SNP`, `InDel`, `Gap`. Toggle to hide
reference-like samples or focus on a specific variant type.

### Sample Filter — Representatives

[![](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/representatives.png)](/hyun52/hap-browser/blob/main/docs/screenshots/representatives.png)

`★ Representatives` collapses the sample list to one representative per
haplotype. Useful for cleaner publication figures and downstream sequence
analysis. `Select All` / `Deselect All` toggle every sample at once;
individual rows are also clickable.

### Haplotype list

Color-coded list with sample counts (`n s` next to each name). Click a
haplotype to filter the matrix to just those samples. The summary line
(`185 haplotypes · 438 variants`) reflects the current Range + Mode.

---

## 5. KASP Marker Design

HapBrowser includes a KASP (Kompetitive Allele Specific PCR) primer designer.
Pick a SNP in the genome view, and it produces a FAM/HEX primer set with
Primer3 validation and the expected sample groups.

The example below uses a SNP at position `9,338,330` in *Hd1*.

### 5.1 Selecting a target SNP

Shift+Click a column header in the genome view to select a SNP. The column
highlights, and a toast at the bottom shows the coordinate. Release Shift
to open the Marker Design modal.

[![Selecting a SNP with Shift+Click](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/kasp_select_snp.png)](/hyun52/hap-browser/blob/main/docs/screenshots/kasp_select_snp.png)

The target here is `9,338,330 G→A` in the *Hd1* CDS:

```
⇔ 9,338,330 - 9,338,330  release → Marker Design
```

### 5.2 Marker Design modal

The modal has two tabs (`KASP (SNP)` / `InDel Marker`) and the selected
range in the top-right badge. The SNP position appears as a gray pill;
click it to activate. Activation reveals the FAM/HEX allele assignment and
the per-haplotype distribution.

[![Marker Design modal — initial (left) and after SNP activation (right)](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/kasp_modal_overview.png)](/hyun52/hap-browser/blob/main/docs/screenshots/kasp_modal_overview.png)

By default the alternative allele goes to FAM and the reference to HEX:

- `FAM — Allele 1: A (Alt)`
- `HEX — Allele 2: G (Ref)`

The haplotype list below shows each haplotype's allele and its sample
count (`G n=2`, `A n=3`, etc.) — the cluster preview you'd expect on a
KASP plate.

### 5.3 Design Options

Click `Design Options ▼` to expand the parameter panel.

[![Design Options expanded](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/kasp_options.png)](/hyun52/hap-browser/blob/main/docs/screenshots/kasp_options.png)

Two toggles at the top:

- **Auto-adjust params** — expands the Tm/GC window automatically if no
  primer fits the current constraints.
- **Avoid neighboring variants** — masks every other SNP/InDel inside the
  primer-binding region. Stricter, fewer candidates. Useful for diverse
  panels but the most common cause of design failure (see 5.5).

Default parameters:

| Parameter | Default |
| --- | --- |
| Amplicon (bp) | 50–150 |
| ASP length (bp) | 21–25 |
| CP length (bp) | 20–30 |
| Tm (°C) | 62–65 |
| GC (%) | 40–60 |
| ASP Tm diff max (°C) | 0.5 |
| ASP/CP Tm diff max (°C) | 3 |
| Hairpin min stem (bp) | 4 |
| Dimer min overlap (bp) | 4 |

The Tm here is from the built-in nearest-neighbor calculation. Primer3
validation (next section) re-computes it under explicit buffer conditions
and may report values ~0.3°C higher.

### 5.4 Design result

Click `Design Marker` to run. A successful result shows the primer table,
Primer3 validation, and the expected sample groups. The `Export` button
top-right downloads a plain-text summary.

[![KASP design result](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/kasp_result.png)](/hyun52/hap-browser/blob/main/docs/screenshots/kasp_result.png)

**Primer table.** Three primers — FAM ASP, HEX ASP, and the common primer.
The gray prefix on each ASP is the universal tail
(`GAAGGTGACCAAGTTCATGCT` for FAM, `GAAGGTCGGAGTCAACGGATT` for HEX). The
blue bolded segment is the allele-specific portion; its 3' base discriminates
the SNP.

| Primer | Sequence | Tm | GC% | Len |
| --- | --- | --- | --- | --- |
| FAM ASP1 (A) | `GAAGGTGACCAAGTTCATGCT-TCCACTGCAGCTCTATCTGACA` | 63.4 | 50% | 22 |
| HEX ASP2 (G) | `GAAGGTCGGAGTCAACGGATT-CCACTGCAGCTCTATCTGACG` | 63.1 | 57% | 21 |
| CP | `ACTACTCCCACTGGATCGATGT` | 63 | 50% | 22 |

**Primer3 validation.** Primer3 v2.3.0 re-computes Tm and ΔG under KASP
buffer conditions (50 mM Na⁺, 1.5 mM Mg²⁺, 0.2 mM dNTP, 250 nM oligo).
ΔG values are color-coded:

- 🟢 green: hairpin ΔG > −3, dimer ΔG > −6 — safe
- 🟠 orange: borderline — usually still works
- 🔴 red: hairpin ΔG < −6, dimer ΔG < −9 — redesign

ASP1×ASP2 cross-dimer often comes out borderline because both ASPs share
the same 3' region. ΔG ≈ −7 kcal/mol is fine for KASP.

**Expected Sample Groups.** Lists the samples in each fluorescence cluster
based on haplotype-allele assignments. Useful for picking controls.

**Exported text.** Square brackets around the allele-specific portion
make the discrimination region easy to inspect. The format pastes directly
into KASP ordering forms (LGC, Standard BioTools).

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
  ...
```

### 5.5 When the design fails

With `Avoid neighboring variants` on, the designer masks every SNP/InDel
inside the candidate primer region. If no candidate fits, it fails with
an explanation:

[![Failed design — blocking variant visualization](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/kasp_blocking.png)](/hyun52/hap-browser/blob/main/docs/screenshots/kasp_blocking.png)

```
⚠ Cannot design Allele1 (A) ASP.
Reasons: 5 candidates blocked by nearby variants (masked)
Local sequence: GC=48%, Tm≈65.1°C
Suggestion: Nearby variants are masking primer sites — try a different SNP
```

The error panel visualizes the ASP binding region and lists the blocking
variants with their position, type, size, and carrier count. `show
varieties` expands the carrier sample list.

If the blocking variant is rare (`n=1`, labeled `rare`), it's often a
sequencing artifact — turn off `Avoid neighboring variants` and re-run.
For common blocking variants (n>10), the primer would fail in those
samples anyway, so try a different target SNP or shorten the ASP length.

---

## 6. InDel Marker Design

InDel markers are a low-cost alternative to KASP — standard PCR plus
gel, no fluorescence reader. The designer takes a genomic range,
identifies all InDel/Gap variants inside, and produces Forward/Reverse
primers with the expected band pattern.

The example below uses a 37 bp range in *Hd1* (`9,337,032 - 9,337,068`)
that contains multiple InDels.

### 6.1 Selecting a target range

Hold Shift and drag across column headers to select a range. Selected
columns highlight in light blue; the toast shows the range and its length.

[![Shift+drag to select a multi-column range](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/indel_select_range.png)](/hyun52/hap-browser/blob/main/docs/screenshots/indel_select_range.png)

```
⇔ 9,337,032 - 9,337,068  release → Marker Design
```

Toggling the MODE filter to show only `InDel` and `Gap` (disabling `SNP`)
helps locate InDel-rich regions before selecting.

### 6.2 Marker Design modal

The InDel Marker tab is auto-selected for multi-column ranges. The modal
summarizes the variant composition and previews the band pattern before
primer design runs.

[![InDel modal — target range info and expected band pattern](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/indel_modal_overview.png)](/hyun52/hap-browser/blob/main/docs/screenshots/indel_modal_overview.png)

The variant count line summarizes what's in the range
(`INS ×1 DEL ×2 GAP ×3`). The Expected Band Pattern lists distinct
bands grouped by net amplicon size offset:

| Band | Offset | Samples | Composition |
| --- | --- | --- | --- |
| 🟢 Ref | 0 | 142 | No variant in range |
| 🟠 Alt | +4 bp | 54 | `INS(+4bp)@9,337,032` |
| 🟠 Alt | +3 bp | 3 | `INS(+4bp)@9,337,032, DEL(-1bp)@9,337,068` |
| 🟠 Alt | −3 bp | 1 | `GAP(-1bp)@9,337,053–055` |

Net offset is the sum of InDel sizes within the range — a `+4bp`
insertion and a `−1bp` deletion in the same haplotype co-migrate as
`+3bp`.

### 6.3 Design Options

[![Design Options and additional band-pattern entries above](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/indel_options.png)](/hyun52/hap-browser/blob/main/docs/screenshots/indel_options.png)

A `⚠ Small InDel detected — PAGE electrophoresis recommended` warning
appears when any predicted band differs from another by less than ~10 bp.

Default parameters:

| Parameter | Default |
| --- | --- |
| Amplicon (bp) | 100–300 |
| Primer length (nt) | 18–25 |
| Tm (°C) | 55–65 |
| GC (%) | 40–60 |
| F/R Tm diff max (°C) | 2 |

The option set is simpler than KASP — Forward/Reverse primers, no
universal tails, no allele-specific 3' end. There's no `Avoid neighboring
variants` either, because the variants inside the amplicon are the
target.

For small InDels (≤5 bp), drop **Amplicon max** to ~150 bp so the
size difference is proportionally larger on a gel.

### 6.4 Design result

[![InDel design result and exported text file](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/indel_result.png)](/hyun52/hap-browser/blob/main/docs/screenshots/indel_result.png)

**Primer table.** Two plain primers, no tails:

| Primer | Sequence | Tm | GC% | Len |
| --- | --- | --- | --- | --- |
| Forward | `AAGGACGAGGAGGTGGACT` | 62.8 | 58% | 19 |
| Reverse | `TAACCACTATGCTGCTGCTCAC` | 63 | 50% | 22 |

A header line shows the amplicon length and any small-InDel warning:

```
⚠ InDel size ~bp — PAGE electrophoresis recommended, keep amplicon ≤ 150bp
```

The 328 bp amplicon in this example is slightly above the default 300 bp
max — Auto-adjust kicked in to find a valid primer pair. Tighten the max
manually for routine small-InDel scoring.

**Primer3 validation** uses the same v2.3.0 cross-check as KASP, with
the same color-coding thresholds.

**Exported text** combines primer info with the full Band Pattern, one
sample per row, listed under its predicted band size:

```
=== InDel Marker Design ===
Gene: Hd1 (Os06g0275000)
Range: 9,337,032 - 9,337,068 (RAP-DB)
Ref Amplicon: 328bp

[Forward Primer]
  5'-AAGGACGAGGAGGTGGACT-3'
  Tm: 62.8°C  GC: 58%  Len: 19nt
[Reverse Primer]
  5'-TAACCACTATGCTGCTGCTCAC-3'
  Tm: 63°C  GC: 50%  Len: 22nt
△ PAGE recommended (small InDel)

--- Band Pattern ---
Ref band (328bp): 142 samples
  Haplotype 1      ERS469118
  Haplotype 1      ERS469194
  ...
```

This is the format you want when scoring a gel — read off the band size
for each lane, look up the haplotype.

### 6.5 InDel size and gel choice

Small InDels (1–5 bp) need PAGE (6–10%) or capillary fragment analysis;
keep the amplicon short (≤150 bp) so the size difference is large
relative to total amplicon length. Medium InDels (5–20 bp) work on
3–4% high-resolution agarose. Anything >20 bp is straightforward on
standard 2% agarose.

Multiple Alt bands (like the +4, +3, −3 bp example above) can resolve
several haplotype groups in one lane, but only if the gel can separate
them. Cross-check the sample composition of each predicted band against
your target germplasm — if your panel only carries the major +4 bp
variant, the assay simplifies to a 2-band score.

For two bands that differ by ≤2 bp, even PAGE may struggle. In that
case a KASP marker on a linked SNP is more practical.

---

## 7. Multi-position Analysis (HapMatrix)

HapMatrix combines positions from multiple genes into a single composite
haplotype table — something the per-gene Genome View can't do. Optional
phenotype data adds per-haplotype summary statistics and box plots.

The example below uses *Hd1* + *Ghd7* + *Hd18* with three traits across
200 IRRI accessions.

### 7.1 Opening HapMatrix

Click `HapMatrix` in the Top Bar.

[![Top bar with HapMatrix button](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/hapmatrix_entry.png)](/hyun52/hap-browser/blob/main/docs/screenshots/hapmatrix_entry.png)

HapMatrix is a view within the same SPA — gene selection and Control
Panel state are preserved when you go back. The `←` arrow top-left
returns to the Genome View.

### 7.2 Interface

[![Empty HapMatrix interface](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/hapmatrix_view.png)](/hyun52/hap-browser/blob/main/docs/screenshots/hapmatrix_view.png)

Two sections: **GENE POSITIONS** (required) and **PHENOTYPE DATA**
(optional).

Each Gene Positions row has a gene dropdown, a RAP-DB position, an
optional end position (for range-based haplotyping), and a `×` to
remove. `+ Add` appends another row; there's no fixed maximum.

`Example` fills in three demo positions plus a phenotype TSV.
`Full Reset` clears everything (with a confirm). `Compute Haplotypes`
runs the analysis.

The fastest way to see what HapMatrix produces is to click `Example` then
`Compute Haplotypes`.

### 7.3 Composite haplotype table

[![Example positions filled in and resulting haplotype table](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/hapmatrix_example.png)](/hyun52/hap-browser/blob/main/docs/screenshots/hapmatrix_example.png)

After `Compute Haplotypes` the results appear below as
`HAPLOTYPES — 5 TYPES · 200 SAMPLES`. Each row is one unique combination
of alleles across all selected positions.

| Hap | n | Hd1 (ref:A) | Ghd7 (ref:C) | Hd18 (ref:T) | Samples |
| --- | --- | --- | --- | --- | --- |
| 1 | 117 | C | C | T | ERS467761, ... `+114 more` |
| 2 | 74 | A | C | T | ERS467797, ... `+71 more` |
| 3 | 5 | A | C | C | ERS468317, ... `+2 more` |
| 4 | 3 | C | C | C | ERS469192, ERS470615, ERS470618 |
| 5 | 1 | C | C | T | ERS470376 |

Alleles are colored: red = reference, green = alternative. Haplotype 1
is always the most common combination under the current set of positions.
Click the blue `n` to see the full sample list. `⬇ Download CSV` exports
one row per sample with the haplotype assignment.

### 7.4 Phenotype data and box plots

Paste or upload a tab-separated phenotype TSV with `SampleID` as the
first column and one numeric trait per additional column.

[![Phenotype panel — TSV input, summary statistics table, and DTH_2021 box plot](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/hapmatrix_boxplot_example.png)](/hyun52/hap-browser/blob/main/docs/screenshots/hapmatrix_boxplot_example.png)

```
SampleID    DTH_2021    DTH_2022    PH_2021
ERS467761   87.1        84.9        96.9
ERS467797   97.7        97.0        109.8
...
```

Sample IDs must match the ones used in the Genome View. Any number of
trait columns is supported; column names become trait labels. Missing
values can be left blank or marked `NA`.

`Generate Example` fills the TSV with a synthetic 200 × 3 demo dataset.

For each trait, HapMatrix shows a summary table (`n`, Min, Max, Mean,
Median, SD per haplotype) and a box plot below it. Boxes are colored
to match the genotype table. `⬇ SVG` / `⬇ PNG` buttons in the top-right
of each plot save the figure.

The example shows a clear signal in DTH_2021: Haplotype 4 (`C-C-C`,
n=3) heads earliest at ~80 days, Haplotype 3 (`A-C-C`, n=5) latest at
~96 days. This kind of combinatorial pattern is invisible from any
single locus analyzed alone.

HapMatrix box plots are exploratory — for ANOVA, Kruskal–Wallis, or
mixed-effects modeling, export the CSV and use R or Python.

### 7.5 State persistence

Gene Positions, the phenotype TSV, and computed results all persist as
you switch between Genome View and HapMatrix. You can build up the
analysis incrementally — find a SNP in one gene, add it as position #1,
go back to find another in a different gene, add as #2, etc. — and
return to HapMatrix at any point.

`Full Reset` clears everything and isn't reversible, so download the
CSV first if you want to keep the analysis. A page reload also clears
state.

To share an analysis, send a collaborator the list of positions and the
phenotype TSV — the output is deterministic given identical inputs.

---

## 8. BLAST Haplotype Search

BLAST identifies what gene, sample, and haplotype an unknown sequence
matches. The database is built from per-sample consensus sequences for
every registered gene.

### 8.1 Opening BLAST

Click `BLAST` in the Top Bar.

[![Top bar with BLAST button](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/hapmatrix_entry.png)](/hyun52/hap-browser/blob/main/docs/screenshots/hapmatrix_entry.png)

### 8.2 Interface

[![BLAST search interface — query input and three buttons](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/blast_view.png)](/hyun52/hap-browser/blob/main/docs/screenshots/blast_view.png)

The blue breadcrumb at the top (`Current Haplotype: CDS · SNP+InDel+Gap
· 185 haplotypes · 438 variants`) shows the classification settings
inherited from the Genome View. The CDS HAP column in the results is
computed under these settings — change Range or Mode in the Control
Panel first if you want different haplotype assignments.

`DB: 24 genes × 135 samples` shows the database size. Only samples with
enough coverage to produce a reliable consensus are included, so the
BLAST sample count can be smaller than the 200-sample Genome View panel.

Three buttons: `Search`, `🪄 Mystery Sample` (auto-fill a demo query),
`Clear`. `Ctrl+Enter` submits the search.

### 8.3 Submitting a query

[![Mystery Sample loaded — 2101 bp FASTA query](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/blast_query.png)](/hyun52/hap-browser/blob/main/docs/screenshots/blast_query.png)

FASTA or raw nucleotide both work. The parser ignores whitespace and is
case-insensitive. Queries ≥500 bp give the most reliable identification;
shorter queries usually still find the right gene but may be ambiguous
at the sample level.

### 8.4 Results

[![BLAST results — top-hit Answer box and 20-row hit table](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/blast_results.png)](/hyun52/hap-browser/blob/main/docs/screenshots/blast_results.png)

The green Answer box gives the most likely identity in one line:

```
💡 Answer: Hd1 (Os06g0275000) — sample ERS468487
```

For most queries this is the only line you need. The table below lists
all hits with `#`, `GENE`, `SAMPLE`, `IDENTITY`, `ALIGN`, `SCORE`,
`E-VALUE`, and `CDS HAP`. CDS HAP is colored to match the same haplotype
in the Genome View — multiple hits with the same color carry the same
classification haplotype.

`⬇ Download TSV` exports the full hit table. The search runs locally
against the precomputed database — nothing is sent to NCBI.

---

## 9. Sample Variety Names

ERS IDs are unambiguous but hard to read at a glance. Mapping them to
variety/cultivar names (e.g., `ERS467761` → `IRIS 313-11973`) makes the
interface easier to follow. The names show up alongside sample IDs
across all views.

### 9.1 Opening the modal

Click the 🏷 tag icon in the Top Bar.

[![Sample varieties modal — empty state](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/sample_varieties.png)](/hyun52/hap-browser/blob/main/docs/screenshots/sample_varieties.png)

`Upload file` loads a TSV/CSV from disk. `Load example (15)` fills a
15-row demo. `Load full (200)` fills the full 200-sample IRIS-ID mapping
that ships with HapBrowser. Paste also works.

### 9.2 File format

Tab- or comma-separated, two required columns:

```
sample_id    variety
ERS467893    IRIS 313-8256
ERS467845    IRIS 313-9438
ERS470235    B017
```

Extra columns (e.g., `subpop`, `country`) are kept as optional metadata.
Unknown sample IDs are silently ignored.

### 9.3 Applying

[![After Load full (200) — 200 rows parsed and Apply activated](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/sample_varieties_loaded.png)](/hyun52/hap-browser/blob/main/docs/screenshots/sample_varieties_loaded.png)

`✓ 200 samples parsed` confirms the input is valid and the `Apply` button
turns blue. Click it to commit. The names appear immediately under each
ERS ID:

[![Sample Filter before (left) and after (right) applying the mapping](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/varieties_before_and_after.png)](/hyun52/hap-browser/blob/main/docs/screenshots/varieties_before_and_after.png)

This is purely a display addition. CSV exports, BLAST result TSVs, and
all internal operations still use the ERS sample IDs.

### 9.4 Managing mappings

Mappings persist across page reloads — apply once and the names stay.

- `Clear input` — empty the text area; saved mappings stay in effect
- `Remove all saved` — delete every saved mapping
- `Cancel` — close without changes
- `Apply` — save the current input

For a custom panel (not the IRRI 200), prepare your own
`sample_id <tab> variety` file and use `Upload file`. The variety column
is free-form text — line names, registration codes, breeding codes all
work.

---

## 10. Protein View

Protein View overlays codon-level annotations on the Genome View. Toggle
it on for AA-aware analysis, off to return to nucleotide view.

Amino-acid coordinates only exist inside the coding sequence, so toggling
Protein on also switches the View filter to **CDS** automatically — UTR
and intron columns are hidden while the overlay is active.

### 10.1 Toggling

Click `🧬 Protein` in the Top Bar.

[![Protein button OFF (top) and ON (bottom)](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/protein_toggle.png)](/hyun52/hap-browser/blob/main/docs/screenshots/protein_toggle.png)

The button turns blue when active. Toggle off and the View filter
returns to whatever it was before.

### 10.2 Annotation rows

Five extra rows appear between Reference and the haplotype matrix. Each
codon spans three nucleotide columns.

[![Protein OFF (top) and ON (bottom) — five annotation rows added](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/protein_off_and_on.png)](/hyun52/hap-browser/blob/main/docs/screenshots/protein_off_and_on.png)

| Row | Meaning |
| --- | --- |
| AA position | 1-based AA coordinate (one number per 3 nt) |
| Ref AA | Reference amino acid, 1-letter code, green |
| Alt AA | Alt AA carried by any sample; `·` if all alternatives are synonymous, a red letter if at least one sample is non-synonymous |
| Synonymous | Count of samples with synonymous variants at this codon |
| Non-syn | Count of samples with non-synonymous variants |
| Frameshift | Count of samples whose frame is shifted at this codon |

In the example, codon 1 is `M → I` (`Non-syn: 1`) — one sample carries an
`ATG → ATA` change that swaps the start methionine for isoleucine.
Codon 11 is `D → V`, another non-synonymous singleton.

The Frameshift count is per-codon, not the number of new frameshift
events. A sample with a 1 bp insertion at codon 5 stays counted in
Frameshift from codon 5 onward, until the frame is restored or a stop
codon is reached. A high Frameshift count across a stretch of codons
usually means one upstream indel inherited across a haplotype group, not
many independent events.

### 10.3 Codon details

Hover a codon for an inline overlay. Click to open the popover.

[![Codon 11 popover (left) and the same content pasted into a spreadsheet (right)](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/protein_aa_change.png)](/hyun52/hap-browser/blob/main/docs/screenshots/protein_aa_change.png)

The popover lists every sample with a variant at this codon, grouped by
type:

- **Non-synonymous (n)** — alt codon and the resulting amino acid
  (e.g., `GTC → V`)
- **Frameshift (n)** — the broken codon sequence (`---`, `--C`, `G--`)
  for each carrier

Clicking `✕ Copy & Close` (or clicking outside the popover) copies the
content to the clipboard as a TSV. Pasted into a spreadsheet:

| Sample | AA pos | Ref Codon | Alt Codon | Ref AA | Alt AA | Type |
| --- | --- | --- | --- | --- | --- | --- |
| ERS467797 | 11 | GAC | `---` | D | `-` | frameshift |
| ... | ... | ... | ... | ... | ... | ... |
| ERS468516 | 11 | GAC | GTC | D | V | nonsynonymous |

### 10.4 Protein-aware export

With Protein View on, the Top Bar `Export` button offers an extra
option.

[![Export modal with Protein on (left) and the exported CSV (right)](https://github.com/hyun52/hap-browser/raw/main/docs/screenshots/protein_export.png)](/hyun52/hap-browser/blob/main/docs/screenshots/protein_export.png)

```
Export based on current view settings.
200 samples × 1215 columns (Identical + SNP + InDel + Gap)

[ Cancel ]   [ ⬇ Download CSV ]   [ ⬇ Non-syn only ]
```

`Download CSV` gives the full matrix with AA position / Ref AA / Alt AA /
Synonymous / Non-syn / Frameshift annotation rows.

`Non-syn only` keeps only columns where at least one sample carries a
non-synonymous variant — typically drops from >1000 to a few dozen
columns. Useful for AA-impact analyses.

`Non-syn only` is hidden when Protein View is off.

---

## 11. Exporting Data

A reference for every export feature in HapBrowser.

| Where | Output | Format | Detail |
| --- | --- | --- | --- |
| Top Bar `⬇ Export` | Per-sample variant matrix | CSV | 11.2 |
| Top Bar `⬇ Export` (Protein on) | Matrix + AA annotation rows | CSV | 10.4 |
| Marker Design (KASP) `⬇ Export` | KASP primer set + sample groups | Plain text | 5.4 |
| Marker Design (InDel) `⬇ Export` | F/R primers + band pattern | Plain text | 6.4 |
| HapMatrix `⬇ Download CSV` | Per-sample composite haplotype | CSV | 7.3 |
| HapMatrix box plot `⬇ SVG` / `⬇ PNG` | One figure per trait | SVG / PNG | 7.4 |
| BLAST `⬇ Download TSV` | Full hit table | TSV | 8.4 |
| Protein codon popover `Copy & Close` | Per-sample codon table | Clipboard TSV | 10.3 |

Everything runs client-side or against the local instance — nothing is
sent to external services. File names default to a gene-and-feature
pattern (e.g., `Hd1_haplotype_matrix.csv`) so multiple exports coexist.

### 11.2 Genome View export

The Top Bar `⬇ Export` button opens a dialog that reports the scope:

```
⬇ Export
Export based on current view settings.
200 samples × 1215 columns (Identical + SNP + InDel + Gap)

[ Cancel ]   [ ⬇ Download CSV ]   [ ⬇ Non-syn only ]
```

"Current view settings" means the live Control Panel state — Range,
Mode, View, Show, Sample Filter, and any applied variety mapping. To
export a different scope, close the dialog, adjust the Control Panel,
and re-open Export.

For publication tables, apply variety names (Section 9), set Sample
Filter to `Representatives`, set Range and View to `CDS`, and export.
That produces a compact one-sample-per-haplotype CSV with both ERS and
cultivar names.

CSV structure (wide table, position columns labeled by RAP-DB coord):

```
Haplotype  Annotation             Variety        CDS       CDS       ...
                                                 9336535   9336536   ...
           RAP-DB position                       9336535   9336536   ...
           Reference nucleotide                  A         T         ...
           Alt nucleotide                        -         -         ...
           Alt sample                            12        13        ...
Hap1       ERS469118              IRIS 313-...   A         T         ...
Hap1       ERS469194              IRIS 313-...   A         T         ...
...
```

Six more annotation rows (AA position, Ref AA, Alt AA, Synonymous,
Non-syn, Frameshift) are inserted when Protein View is on.

Excel may mis-parse the leading annotation rows on double-click. Use
`Data → From Text/CSV`, or read in R/Python with explicit `skip` /
`header` arguments.

---

## 12. Keyboard Shortcuts

### Genome View

| Action | Shortcut |
| --- | --- |
| Scroll samples | Mouse wheel |
| Scroll positions | Horizontal wheel / Shift + wheel |
| Navigate cells | Arrow keys |
| Select a SNP (KASP) | Shift + Click on a column |
| Select a range (InDel) | Shift + Drag across columns |
| Haplotype details | Click a haplotype header |

### Top Bar

| Action | Shortcut |
| --- | --- |
| Jump to RAP-DB position | Type coord, Enter |

### BLAST

| Action | Shortcut |
| --- | --- |
| Submit query | Ctrl + Enter (Cmd + Enter on macOS) |

### Protein View

| Action | Shortcut |
| --- | --- |
| Inline codon overlay | Hover |
| Open detail popover | Click |
| Close & copy to clipboard | Click outside, or `✕ Copy & Close` |
