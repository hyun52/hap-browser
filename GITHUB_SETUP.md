# GitHub Setup Guide (One-time, for the maintainer)

This file documents how to push HapBrowser to GitHub for the first time.
Once on GitHub, this file can be removed or kept for reference.

## 1. Prepare the repository

Apply the GitHub MVP package files to your existing project:

```bash
cd /path/to/hap-browser

# Extract MVP package (contains LICENSE, README.md, .gitignore, etc.)
tar xzf hap-browser-github-mvp.gz

# Verify
ls LICENSE README.md CITATION.cff CONTRIBUTING.md .gitignore
ls .github/ISSUE_TEMPLATE/
```

## 2. Initialize git

```bash
cd /path/to/hap-browser

# If not already a git repo
git init
git branch -M main
```

## 3. Stage files (excluding large data)

The `.gitignore` already excludes BAM files, logs, node_modules, etc.

Verify nothing huge slipped through:

```bash
# Check repo size before committing
du -sh . --exclude=node_modules --exclude=.snakemake --exclude=public/data/bam --exclude=logs

# List what would be committed
git add -A
git status

# Inspect specifically large files staged
git ls-files | xargs -I{} du -h "{}" 2>/dev/null | sort -rh | head -20
```

If any single file is >50 MB, consider:
- Adding it to `.gitignore`
- Moving it to a GitHub Release artifact
- Using Git LFS (`git lfs track "*.json"`)

## 4. Initial commit

```bash
git add -A
git commit -m "Initial public release: HapBrowser v1.0.0

- 23 rice heading-date genes + Sub1A across 200 IRRI accessions
- Snakemake pipeline for adding new genes (FASTQ → browser)
- KASP/InDel marker design with Primer3 validation
- Variant-aware primer design with diagnostic visualization
- Canvas-based variant matrix rendering (60fps with 200+ samples)
"
```

## 5. Create GitHub repo and push

On https://github.com/hyun52, click "New repository":

- **Name**: `hap-browser`
- **Description**: "Rice haplotype browser with integrated marker design"
- **Visibility**: Public
- **Initialize**: leave all unchecked (we already have files locally)

Then:

```bash
git remote add origin https://github.com/hyun52/hap-browser.git
git push -u origin main
```

## 6. Configure repo settings (on GitHub)

Recommended settings:

- **About** sidebar: add description, website (if any), topics:
  `rice` `haplotype-browser` `bioinformatics` `snakemake` `pangenome` `kasp-marker` `genomics` `react`
- **License**: should auto-detect from `LICENSE` file, but it's a custom one so it may show "Other"
- **Citation**: should auto-detect from `CITATION.cff`
- **Releases**: create v1.0.0 release
  ```bash
  git tag -a v1.0.0 -m "v1.0.0 — Initial public release"
  git push origin v1.0.0
  ```
  Then on GitHub: Releases → Draft a new release → tag v1.0.0

## 7. Add screenshots (recommended)

The README references `docs/screenshots/*.png` files that don't exist yet.

```bash
mkdir -p docs/screenshots

# Take screenshots of:
# - main_view.png       (main HapBrowser interface with Hd1 loaded)
# - genome_view.png     (full region Canvas view)
# - marker_design.png   (KASP marker design panel with results)
# - hapmatrix.png       (HapMatrix with phenotype box plots)
# - blocking_variants.png (variant-aware diagnostic from latest patch)

# Add to git
git add docs/screenshots/
git commit -m "Add README screenshots"
git push
```

## 8. (Optional) GitHub Pages for live demo

If you want to host a live demo:

```bash
# Configure Vite for GitHub Pages base path
# Edit vite.config.js: base: '/hap-browser/'

# Build and deploy gh-pages branch
npm install --save-dev gh-pages

# Add to package.json scripts:
#   "deploy": "vite build && gh-pages -d dist"

npm run deploy
```

Settings → Pages → Source: gh-pages branch → enable.

⚠️ Note: live demo without backend means KASP Primer3 validation won't work, but everything else (haplotype views, marker design with built-in Tm calc) will.

## 9. Announce

- Post in lab Slack / Notion
- Tweet / LinkedIn (optional)
- Submit to bioinformatics tool aggregators if applicable
- Add to your CV / website

---

## Maintenance afterwards

### Releasing a new version

```bash
# 1. Update version in package.json
# 2. Update CHANGELOG_pipeline.md
# 3. Commit and tag

git add package.json CHANGELOG_pipeline.md
git commit -m "Bump version to v1.1.0"
git tag -a v1.1.0 -m "v1.1.0 — [summary of changes]"
git push origin main --tags
```

Then on GitHub create a release from the new tag.

### Removing this file

Once you're set up, you can delete this file:

```bash
git rm GITHUB_SETUP.md
git commit -m "Remove one-time setup guide"
git push
```
