# CHANGELOG

## v1.1.1
- Data archive is self-contained again: the per-gene accession lists
  (`bam/<gene>/samples.json`) were missing from the v1.1.0 archive, so a clean
  install from that archive alone rendered an empty matrix.
- The browser no longer depends on those files. The accession list is read from
  the packed pileup metadata, or from the precomputed summary, when
  `samples.json` is absent.
- A data file that was never installed is now reported by name. The dev server
  answers an unknown path under `data/` with the single-page shell rather than a
  404, which previously surfaced as `Unexpected token '<' ... is not valid JSON`.

## v1.1.0
- Packed binary pileup format (`all.bin`), replacing the per-sample JSON.
- Variant filter: heterozygous positions are marked `H` and withheld from
  haplotype classification.
- Marker-design fixes.

## v1.0
First release
