# Contributing to HapBrowser

Thanks for your interest! HapBrowser is an academic project, and contributions of all sizes are welcome.

## Quick Start for Contributors

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/hap-browser.git
cd hap-browser

# Install dependencies
npm install
pip install -r backend/requirements.txt

# Run dev server
npm run dev
```

## Types of Contributions

### 🐛 Bug Reports

Open an issue with:
- Version number (`grep version package.json`)
- Operating system and browser
- Steps to reproduce
- Expected vs. actual behavior
- Relevant logs (`logs/` folder or browser DevTools console)

### 💡 Feature Requests

Open an issue describing:
- The use case (what problem does this solve?)
- Proposed UI / workflow
- Any alternatives you've considered

### 🔧 Pull Requests

Small, focused PRs are easier to review. Please:
1. Open an issue first if it's a substantial change (>100 lines or new dependency)
2. Make sure `npx vite build` succeeds
3. Make sure `./add_genes.sh --dry-run ...` still works for the pipeline (if pipeline changes)
4. Update relevant documentation

## Code Style

- **JavaScript / React**: existing files use 2-space indent, no semicolons-required style
- **Python**: PEP 8 broadly; `f-strings` preferred
- **Shell**: `#!/bin/bash` + `set -euo pipefail`
- **Snakemake**: per-gene rules preferred over single global rules; use `ancient()` to break unnecessary mtime cascades

## Testing Pipeline Changes

Before submitting pipeline-related PRs:

```bash
# Add a test gene (rice gene with known data)
echo -e "Os07g0281400\tYield components\tDRO1" >> genes.tsv

# Dry-run should show only this gene's jobs
./add_genes.sh --dry-run [args]

# Full run should complete in ~30-45 min for 200 samples
./add_genes.sh [args]
```

## Documentation Updates

If your change affects user-facing behavior, update:
- `USER_GUIDE_ADD_GENES.md` for pipeline / user workflow changes
- `README_pipeline.md` for pipeline internals
- `CHANGELOG_pipeline.md` (always)
- `README.md` for headline features

## License Note

By contributing, you agree that your contributions will be licensed under the same Academic Non-Commercial License as the project. See [LICENSE](LICENSE) for details.

## Questions?

Open an issue or reach out via the GitHub repository. Thank you for helping make HapBrowser better!
