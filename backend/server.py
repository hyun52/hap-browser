#!/usr/bin/env python3
"""
backend/server.py — HapBrowser BLAST API
DB: per-sample consensus sequences (13 genes × 135 samples)
Results include Gene-based and CDS-based haplotype assignments.
"""
import argparse, json, subprocess, sys, traceback, io, tempfile, os
from pathlib import Path

try:
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse, StreamingResponse
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("pip install fastapi uvicorn pydantic"); sys.exit(1)

# primer3-py — optional; validate endpoint gracefully disables if unavailable
try:
    import primer3 as _primer3
    PRIMER3_AVAILABLE = True
except ImportError:
    _primer3 = None
    PRIMER3_AVAILABLE = False

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATA_DIR = Path("./public/data")
PROJECT_ROOT = Path(".")
BLAST_DB_DIR = None
DB_NAME = "samples"
DB_READY = False
GENES = {}          # gene_id -> gene info
SAMPLE_INFO = {}    # "gene_id/sample_id" -> { gene_id, gene_sym, sample_id, seq }
# Haplotype assignments: gene_id -> { gene_gap: {sid->hap}, gene_nogap, cds_gap, cds_nogap }
HAP_ASSIGN = {}

MIN_DEPTH = 5

class Q(BaseModel):
    query: str

def find_blast():
    for c in ["blastn", "makeblastdb"]:
        try: subprocess.run([c, "-version"], capture_output=True, timeout=10, check=True)
        except: print(f"  x {c}"); return False
    return True

def resolve(rel):
    for p in [PROJECT_ROOT / rel,
              DATA_DIR / (rel.replace("data/", "", 1) if rel.startswith("data/") else rel),
              DATA_DIR / rel]:
        if p.exists(): return p
    return None

def load_genes():
    idx = DATA_DIR / "index.json"
    if not idx.exists(): print(f"x {idx}"); return False
    with open(idx) as f: index = json.load(f)
    ok = 0
    for g in index.get("groups", []):
        for gi in g.get("genes", []):
            fp = resolve(gi.get("fa", ""))
            if fp:
                with open(fp) as f:
                    seq = "".join(l.strip() for l in f if not l.startswith(">")).upper()
                gi["_seq"] = seq
                ok += 1
                # Load GFF for CDS info
                gff_path = resolve(gi.get("gff", ""))
                gi["_features"] = parse_gff(gff_path) if gff_path else []
                print(f"  + {gi['id']} ({gi.get('sym','?')}) {len(seq)}bp")
            else:
                gi["_seq"] = ""
                gi["_features"] = []
                print(f"  - {gi['id']} not found")
            GENES[gi["id"]] = gi
    print(f"Loaded {ok}/{len(GENES)}")
    return ok > 0

def parse_gff(path):
    """Simple GFF3 parser for CDS/UTR/mRNA features."""
    features = []
    try:
        with open(path) as f:
            for line in f:
                if line.startswith("#"): continue
                parts = line.strip().split("\t")
                if len(parts) < 9: continue
                ftype = parts[2]
                if ftype not in ("mRNA", "CDS", "exon", "five_prime_UTR", "three_prime_UTR"): continue
                attrs = {}
                for a in parts[8].split(";"):
                    if "=" in a:
                        k, v = a.split("=", 1)
                        attrs[k] = v
                features.append({
                    "type": ftype, "start": int(parts[3]), "end": int(parts[4]),
                    "strand": parts[6], "attrs": attrs,
                })
    except: pass
    return features

def get_cds_positions(gi):
    """Get CDS position set for a gene."""
    features = gi.get("_features", [])
    target_mrnas = set()
    for f in features:
        if f["type"] == "mRNA" and f["attrs"].get("Locus_id") == gi["id"]:
            target_mrnas.add(f["attrs"].get("ID", ""))
    cds_set = set()
    for f in features:
        if f["type"] in ("CDS", "exon") and f["attrs"].get("Parent", "") in target_mrnas:
            for p in range(f["start"], f["end"] + 1):
                cds_set.add(p)
    return cds_set

def get_gene_range(gi):
    """Get gene body range (5'UTR ~ 3'UTR)."""
    features = gi.get("_features", [])
    gls = gi.get("gene_start", 0) - gi.get("offset", 0)
    gle = gi.get("gene_end", 0) - gi.get("offset", 0)
    target_mrnas = set()
    for f in features:
        if f["type"] == "mRNA" and f["attrs"].get("Locus_id") == gi["id"]:
            target_mrnas.add(f["attrs"].get("ID", ""))
    tx_start, tx_end = gls, gle
    for f in features:
        if f["attrs"].get("Parent", "") in target_mrnas or f["attrs"].get("ID", "") in target_mrnas:
            if f["start"] < tx_start: tx_start = f["start"]
            if f["end"] > tx_end: tx_end = f["end"]
    return tx_start, tx_end

def build_sample_db():
    """Build per-sample consensus sequences and compute haplotype assignments.
    Caches BLAST DB and haplotype assignments to DATA_DIR/blast_db/.
    Skips rebuild if cache exists.
    """
    global DB_READY, BLAST_DB_DIR

    # Use persistent cache directory
    cache_dir = DATA_DIR / "blast_db"
    cache_dir.mkdir(exist_ok=True)
    BLAST_DB_DIR = cache_dir

    cache_info = cache_dir / "cache_info.json"
    cached_db = cache_dir / f"{DB_NAME}.ndb"
    cached_hap = cache_dir / "hap_assign.json"
    cached_samples = cache_dir / "sample_info.json"

    # Check if cache is valid
    if cached_db.exists() and cached_hap.exists() and cached_samples.exists():
        try:
            with open(cache_info) as f:
                info = json.load(f)
            # Quick check: same gene count
            if info.get("gene_count") == len(GENES):
                print("  Found cached BLAST DB, loading...")
                with open(cached_hap) as f:
                    cached = json.load(f)
                    for gid, assigns in cached.items():
                        HAP_ASSIGN[gid] = assigns
                with open(cached_samples) as f:
                    cached_si = json.load(f)
                    for k, v in cached_si.items():
                        SAMPLE_INFO[k] = v
                DB_READY = True
                print(f"  Loaded {len(SAMPLE_INFO)} samples from cache")
                return
        except:
            print("  Cache invalid, rebuilding...")

    print("  Building from scratch (this may take a while)...")
    total_seqs = 0

    for gid, gi in GENES.items():
        ref = gi.get("_seq", "")
        if not ref: continue
        pileup_dir = DATA_DIR / "pileup" / gid
        if not pileup_dir.exists(): continue

        rlen = gi.get("region_length", len(ref))
        gls = gi.get("gene_start", 0) - gi.get("offset", 0)
        gle = gi.get("gene_end", 0) - gi.get("offset", 0)
        cds_set = get_cds_positions(gi)
        gene_start, gene_end = get_gene_range(gi)

        # Load all pileups and build consensus for each sample
        sample_seqs = {}
        sample_alleles = {}

        for pf in sorted(pileup_dir.glob("*.json")):
            sid = pf.stem
            if sid == "all": continue  # skip merged file
            try:
                with open(pf) as f: data = json.load(f)
                pileup = data.get("pileup", {})
            except: continue

            cons = list(ref)
            alleles = {}
            for pos in range(1, rlen + 1):
                p = pileup.get(str(pos))
                if not p:
                    alleles[pos] = '-'
                    continue
                tot = sum(p.get(b, 0) for b in "ATGC") + p.get("del", 0) + p.get("ins", 0)
                if tot < MIN_DEPTH:
                    alleles[pos] = '-'
                    continue
                if p.get("del", 0) > tot * 0.3:
                    alleles[pos] = 'D'
                    continue
                bases = {b: p.get(b, 0) for b in "ATGC"}
                dom = max(bases, key=bases.get)
                alleles[pos] = dom
                if pos - 1 < len(cons):
                    cons[pos - 1] = dom

            seq = "".join(cons)
            sample_seqs[sid] = seq
            sample_alleles[sid] = alleles

            key = f"{gid}/{sid}"
            SAMPLE_INFO[key] = {
                "gene_id": gid, "gene_sym": gi.get("sym", gid),
                "sample_id": sid, "seq": seq,
            }
            total_seqs += 1

        if not sample_seqs: continue

        sids = sorted(sample_seqs.keys())
        scan_start = max(1, gls - 3000)
        scan_end = min(rlen, gle + 1000)

        pos_data = []
        for pos in range(scan_start, scan_end + 1):
            if pos > len(ref): continue
            r = ref[pos - 1]
            if r == 'N': continue
            has_snp = False
            has_gap = False
            for sid in sids:
                al = sample_alleles.get(sid, {}).get(pos, r)
                if al == '-' or al == 'D':
                    has_gap = True
                elif al != r:
                    has_snp = True
            if has_snp or has_gap:
                pos_data.append((pos, has_snp, has_gap,
                                 gene_start <= pos <= gene_end,
                                 pos in cds_set))

        gene_haps = {}
        for target in ['gene', 'cds']:
            for gap in [True, False]:
                vps = []
                for (pos, hs, hg, ig, ic) in pos_data:
                    if target == 'cds' and not ic: continue
                    if target == 'gene' and not ig: continue
                    if not gap and not hs: continue
                    vps.append(pos)

                pm = {}
                for sid in sids:
                    pat = tuple(sample_alleles.get(sid, {}).get(p, ref[p-1]) for p in vps)
                    pm.setdefault(pat, []).append(sid)

                ref_pat = tuple(ref[p-1] for p in vps)
                sorted_pats = sorted(pm.items(),
                    key=lambda x: sum(1 for a, b in zip(x[0], ref_pat) if a != b))

                assign = {}
                for hi, (pat, group_sids) in enumerate(sorted_pats):
                    hap_id = f"Hap{hi+1}"
                    for s in group_sids:
                        assign[s] = hap_id

                key = f"{target}_{'gap' if gap else 'nogap'}"
                if gid not in gene_haps: gene_haps[gid] = {}
                gene_haps[gid][key] = assign

        HAP_ASSIGN[gid] = gene_haps.get(gid, {})
        print(f"  + {gid}: {len(sample_seqs)} samples")

    print(f"Total: {total_seqs} sample sequences")

    # Write FASTA and build BLAST DB
    if not SAMPLE_INFO: return
    fa = cache_dir / f"{DB_NAME}.fa"
    with open(fa, "w") as f:
        for k, v in SAMPLE_INFO.items():
            f.write(f">{k}\n")
            s = v["seq"]
            for i in range(0, len(s), 80):
                f.write(s[i:i+80] + "\n")

    r = subprocess.run(["makeblastdb", "-in", str(fa), "-dbtype", "nucl",
                        "-out", str(cache_dir / DB_NAME)],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print(f"makeblastdb err: {r.stderr}")
        return

    # Save cache
    # Save hap_assign (convert to serializable format)
    with open(cached_hap, "w") as f:
        json.dump(HAP_ASSIGN, f)
    # Save sample_info (without seq to save space — seq is in FASTA)
    si_save = {}
    for k, v in SAMPLE_INFO.items():
        si_save[k] = {kk: vv for kk, vv in v.items() if kk != "seq"}
    with open(cached_samples, "w") as f:
        json.dump(si_save, f)
    with open(cache_info, "w") as f:
        json.dump({"gene_count": len(GENES), "sample_count": total_seqs}, f)

    DB_READY = True
    print(f"DB ready ({total_seqs} seqs) — cached to {cache_dir}")


@app.post("/api/blast")
async def blast(req: Q):
    if not DB_READY:
        return JSONResponse(503, {"detail": "DB not ready"})
    try:
        clean = ''.join(l for l in req.query.strip().split('\n') if not l.startswith('>')).upper()
        clean = ''.join(c for c in clean if c in 'ATGCN')
        print(f"[Q] len={len(clean)}")
        if len(clean) < 15:
            return JSONResponse(400, {"detail": f"Too short ({len(clean)}bp)"})

        qp = BLAST_DB_DIR / "q.fa"
        with open(qp, "w") as f:
            f.write(f">query\n")
            for i in range(0, len(clean), 80):
                f.write(clean[i:i+80] + "\n")

        r = subprocess.run([
            "blastn", "-query", str(qp), "-db", str(BLAST_DB_DIR / DB_NAME),
            "-outfmt", "6 sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore",
            "-max_target_seqs", "20", "-evalue", "1e-10", "-word_size", "11",
            "-dust", "no",
        ], capture_output=True, text=True, timeout=120)

        if r.returncode != 0:
            print(f"blastn err: {r.stderr[:300]}")
            return JSONResponse(500, {"detail": r.stderr[:300]})

        hits = []
        seen = set()
        for line in r.stdout.strip().split("\n"):
            if not line.strip(): continue
            p = line.split("\t")
            if len(p) < 11: continue
            sid_key = p[0]  # "gene_id/sample_id"
            if sid_key in seen: continue
            seen.add(sid_key)

            info = SAMPLE_INFO.get(sid_key, {})
            gid = info.get("gene_id", "?")
            sample_id = info.get("sample_id", "?")
            gi = GENES.get(gid, {})
            hap_assign = HAP_ASSIGN.get(gid, {})

            hits.append({
                "gene_id": gid,
                "gene_sym": info.get("gene_sym", "?"),
                "sample_id": sample_id,
                "identity": round(float(p[1]), 1),
                "align_length": int(p[2]),
                "score": round(float(p[10]), 1),
                "evalue": p[9],
                "region": f"{gi.get('chr','?')}:{gi.get('region_start','?')}-{gi.get('region_end','?')}",
                "hap_gene_gap": hap_assign.get("gene_gap", {}).get(sample_id, "?"),
                "hap_gene_nogap": hap_assign.get("gene_nogap", {}).get(sample_id, "?"),
                "hap_cds_gap": hap_assign.get("cds_gap", {}).get(sample_id, "?"),
                "hap_cds_nogap": hap_assign.get("cds_nogap", {}).get(sample_id, "?"),
            })

        hits.sort(key=lambda h: h["score"], reverse=True)
        print(f"[R] {len(hits)} hits")
        return {"hits": hits, "query_length": len(clean)}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(500, {"detail": str(e)})




class ExportRequest(BaseModel):
    gene_id: str
    haplotypes: list        # [{id, samples:[...]}]
    shown_samples: list     # currently filtered samples
    variant_positions: list # [pos, ...]
    pos_mode: str = "rapdb" # rapdb | local

@app.post("/api/export")
async def export_csv(req: ExportRequest):
    """Generate CSV matching the current view and return it as a streaming response."""
    try:
        gene_id = req.gene_id
        pc_path = DATA_DIR / "precomputed" / f"{gene_id}.json"
        if not pc_path.exists():
            return JSONResponse(status_code=404, content={"detail": f"{gene_id}.json not found"})

        with open(pc_path) as f:
            pc = json.load(f)

        offset   = pc.get("offset", 0)
        seq      = pc.get("seq", "")
        samples  = pc.get("samples", [])
        pd_list  = pc.get("positionData", [])
        gene_sym = pc.get("gene_sym", gene_id)
        chr_name = GENES.get(gene_id, {}).get("chr", "")

        pd_map = {pd["pos"]: pd for pd in pd_list}
        sample_idx = {s: i for i, s in enumerate(samples)}

        shown_set = set(req.shown_samples)
        positions = req.variant_positions

        # annotation
        def classify(pos):
            pd = pd_map.get(pos, {})
            f  = pd.get("f", 0)
            if f & 32: return "CDS"
            if f & 16: return "Intron"
            gs = pc.get("gene_start", 0) - offset
            ge = pc.get("gene_end", 0) - offset
            if pos < gs: return "Upstream"
            if pos > ge: return "Downstream"
            return "Gene"

        def get_pos_label(pos):
            return str(pos + offset) if req.pos_mode == "rapdb" else str(pos)

        def get_allele(pos, sid):
            pd = pd_map.get(pos)
            ref = seq[pos - 1] if 0 < pos <= len(seq) else "N"
            if not pd: return ref
            enc = pd.get("enc", "")
            si  = sample_idx.get(sid, -1)
            if si < 0 or si >= len(enc): return ref
            c   = enc[si]
            if c == "0": return ref
            if c == "-": return "-"
            alt_list = pd.get("alt", [])
            idx = int(c) - 1
            return alt_list[idx] if idx < len(alt_list) else ref

        # CSV generation
        lines = []
        esc = lambda v: (f'"{str(v).replace(chr(34), chr(34)*2)}"' 
                         if "," in str(v) or '"'  in str(v) else str(v))

        # header rows
        annots  = [classify(p) for p in positions]
        pos_lbl = [get_pos_label(p) for p in positions]
        refs    = [seq[p-1] if 0 < p <= len(seq) else "N" for p in positions]

        lines.append(",".join(["Haplotype", "Annotation"] + annots))
        lines.append(",".join(["", "RAP-DB position" if req.pos_mode == "rapdb" else "Local position"] + pos_lbl))
        lines.append(",".join(["", "Reference"] + refs))

        # sample rows
        for hap in req.haplotypes:
            hap_id = hap["id"]
            for sid in hap["samples"]:
                if sid not in shown_set: continue
                alleles = [get_allele(p, sid) for p in positions]
                lines.append(",".join([esc(hap_id), esc(sid)] + alleles))

        csv_content = "\ufeff" + "\n".join(lines)  # UTF-8 BOM
        filename = f"{gene_id}_{gene_sym}_haplotype.csv"

        return StreamingResponse(
            io.StringIO(csv_content),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.get("/api/health")
async def health():
    return {"ready": DB_READY, "genes": len(GENES), "samples": len(SAMPLE_INFO),
            "primer3": PRIMER3_AVAILABLE}


# ─── Primer3 validation ─────────────────────────────────────────────────────
# Validate KASP primer pair (ASP/CP) designed in JS using Primer3 for precise thermo checks.
# Design itself is done in JS — this endpoint only computes Tm/hairpin/homodimer/heterodimer.
# Conditions: [oligo]=250 nM, [Na+]=50 mM, [Mg2+]=1.5 mM, [dNTP]=0.2 mM (KASP defaults).

class PrimerCheck(BaseModel):
    seq: str                                  # primer sequence (excluding tail)
    label: str | None = None                  # identifier like 'asp1' | 'asp2' | 'cp'

class PrimerValidateReq(BaseModel):
    primers: list[PrimerCheck]                # 1-N items (usually 3: asp1/asp2/cp)
    # Thermodynamic conditions (KASP standard defaults)
    mv_conc: float = 50.0     # monovalent cation mM
    dv_conc: float = 1.5      # divalent cation mM (Mg2+)
    dntp_conc: float = 0.2    # dNTP mM
    dna_conc: float = 250.0   # oligo nM
    temp_c: float = 37.0      # reaction temp for hairpin/dimer predictions


@app.post("/api/primer3/validate")
async def primer3_validate(req: PrimerValidateReq):
    """Primer3 thermodynamic calculations for a list of primers.

    Returns per-primer Tm, hairpin ΔG/Tm, self-dimer ΔG/Tm, and all
    pairwise hetero-dimer ΔG/Tm. Based on primer3-py's `calc_tm`,
    `calc_hairpin`, `calc_homodimer`, `calc_heterodimer` (SantaLucia 1998
    thermodynamics; Owczarzy 2008 salt correction).
    """
    if not PRIMER3_AVAILABLE:
        return JSONResponse(
            status_code=503,
            content={"error": "primer3-py not installed on server. "
                              "Install with: pip install primer3-py"})
    try:
        kw = dict(mv_conc=req.mv_conc, dv_conc=req.dv_conc,
                  dntp_conc=req.dntp_conc, dna_conc=req.dna_conc,
                  temp_c=req.temp_c)

        per_primer = []
        for p in req.primers:
            seq = (p.seq or '').upper()
            if not seq or not all(b in 'ATGCN' for b in seq):
                per_primer.append({
                    "label": p.label, "seq": seq,
                    "error": "Invalid sequence (must be A/T/G/C)"})
                continue

            tm = _primer3.calc_tm(seq, mv_conc=req.mv_conc, dv_conc=req.dv_conc,
                                  dntp_conc=req.dntp_conc, dna_conc=req.dna_conc)
            hp = _primer3.calc_hairpin(seq, **kw)
            sd = _primer3.calc_homodimer(seq, **kw)
            per_primer.append({
                "label": p.label, "seq": seq, "length": len(seq),
                "tm":       round(tm, 2),
                "gc":       round(100 * sum(1 for b in seq if b in 'GC') / len(seq), 1),
                "hairpin":  {"found": hp.structure_found, "tm": round(hp.tm, 2),
                             "dg":    round(hp.dg / 1000, 2)},   # cal → kcal/mol
                "homodimer":{"found": sd.structure_found, "tm": round(sd.tm, 2),
                             "dg":    round(sd.dg / 1000, 2)},
            })

        # Pair-wise heterodimers
        heterodimers = []
        for i in range(len(req.primers)):
            for j in range(i + 1, len(req.primers)):
                s1, s2 = req.primers[i].seq.upper(), req.primers[j].seq.upper()
                l1, l2 = req.primers[i].label, req.primers[j].label
                if not (s1 and s2 and all(b in 'ATGCN' for b in s1 + s2)):
                    continue
                hd = _primer3.calc_heterodimer(s1, s2, **kw)
                heterodimers.append({
                    "a": l1, "b": l2,
                    "found": hd.structure_found,
                    "tm":    round(hd.tm, 2),
                    "dg":    round(hd.dg / 1000, 2),
                })

        return {"ok": True, "primers": per_primer,
                "heterodimers": heterodimers,
                "conditions": {"Na_mM": req.mv_conc, "Mg_mM": req.dv_conc,
                               "dNTP_mM": req.dntp_conc, "oligo_nM": req.dna_conc,
                               "temp_C": req.temp_c},
                "primer3_version": getattr(_primer3, '__version__', 'unknown')}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


def main():
    global DATA_DIR, PROJECT_ROOT, BLAST_DB_DIR
    pa = argparse.ArgumentParser()
    pa.add_argument("--port", type=int, default=8081)
    pa.add_argument("--data-dir", default="./public/data")
    pa.add_argument("--host", default="0.0.0.0")
    a = pa.parse_args()
    DATA_DIR = Path(a.data_dir).resolve()
    PROJECT_ROOT = DATA_DIR.parent
    for p in [DATA_DIR.parent, DATA_DIR.parent.parent, DATA_DIR.parent.parent.parent]:
        if (p / "package.json").exists(): PROJECT_ROOT = p; break
    BLAST_DB_DIR = DATA_DIR / "blast_db"
    BLAST_DB_DIR.mkdir(exist_ok=True)
    print(f"\n{'='*55}\n  HapBrowser BLAST API\n{'='*55}")
    print(f"  data: {DATA_DIR}\n  root: {PROJECT_ROOT}\n  db:   {BLAST_DB_DIR}\n")
    if not find_blast(): print("Need BLAST+"); sys.exit(1)
    print("  + BLAST+\n\nLoading genes...")
    if not load_genes(): print("No genes loaded"); sys.exit(1)
    print("\nBuilding sample DB + haplotype assignments...")
    build_sample_db()
    print(f"\n  POST http://localhost:{a.port}/api/blast")
    print(f"  DB: {'OK' if DB_READY else 'FAIL'}\n{'='*55}\n")
    # On port conflict, try the next port automatically
    port = a.port
    for attempt in range(10):
        try:
            print(f"  Starting on port {port}...")
            uvicorn.run(app, host=a.host, port=port, log_level="info")
            break
        except OSError as e:
            if 'address already in use' in str(e).lower():
                print(f"  Port {port} in use, trying {port+1}...")
                port += 1
            else:
                raise

if __name__ == "__main__":
    main()
