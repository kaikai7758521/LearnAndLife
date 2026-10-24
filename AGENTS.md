# AGENTS.md

## Project

Static Markdown notes site published on GitHub Pages. No build step, no package manager, no bundler: `index.html` loads Markdown/KaTeX/Mermaid/highlight.js from CDNs and renders notes client-side. Chinese notes are the source of truth; English translations live under `en/`, mirroring the Chinese directory tree with the same filenames.

## Layout

- `index.html` — single entry point.
- `assets/js/app.js` — router (`#/path.md@anchor`), sidebar tree, search, Markdown rendering, TOC, pager, window UI (~2k lines).
- `assets/js/i18n.js` — zh/en UI strings; keep both language packs in sync.
- `assets/js/config.js` — repo/home/exclude config (deployment only; display text lives in `site.json`).
- `assets/css/style.css` — all styling, macOS desktop look, dark theme.
- `site.json` — title, subtitle, brand icon, footer (zh + en variants).
- `manifest.json` / `manifest.en.json` — generated note indexes. **Do not hand-edit.**
- `dirs.en.json` — generated Chinese→English folder label map; auto-filled for new directories, safe to correct individual labels by hand.
- `README.md` / `en/README.md` — Chinese/English home pages + generated outline between `<!-- NOTES:START -->` / `<!-- NOTES:END -->`. **Do not edit inside the markers.**
- `scripts/update-readme.py` — regenerates manifests and README outlines.
- `scripts/translate-notes.py` — generates `en/` translations, `manifest.en.json`, and `dirs.en.json` (folder labels).
- `scripts/*.ps1` — optional Windows-only helpers; not needed on macOS.
- Notes: `<学习方向>/<内容>/<细节>.md`, Chinese names allowed, numeric prefixes (`01-`) only for ordering and hidden in UI. English mirror: `en/<学习方向>/<内容>/<细节>.md`.

## Commands

Run from the repo root:

```bash
# Local preview (file:// cannot fetch Markdown)
python3 -m http.server 8080

# Regenerate manifests + README outlines after adding/changing notes
python3 scripts/update-readme.py
python3 scripts/update-readme.py --check        # verify, non-zero if stale
python3 scripts/update-readme.py --no-manifest  # README only

# Translations (free by default: Google -> MyMemory; no key required)
# Optional: TRANSLATE_PROVIDER=google|mymemory|libretranslate|openai,
# TRANSLATE_API_KEY / TRANSLATE_API_URL / TRANSLATE_MODEL for openai,
# MYMEMORY_EMAIL for a higher quota, LIBRETRANSLATE_URL / LIBRETRANSLATE_API_KEY.
python3 scripts/translate-notes.py
python3 scripts/translate-notes.py --check
python3 scripts/translate-notes.py --force
python3 scripts/translate-notes.py --strict
```

There is no test suite or linter. Verification = run `update-readme.py --check` and open the site locally.

## Conventions and gotchas

- Adding a note: create `分类/主题/文件名.md` with optional front matter (`title`, `date`, `updated`, `icon`, `tags`, `description`), then run `update-readme.py` so `manifest*.json` and `README*.md` stay current. The GitHub Action (`.github/workflows/build-manifest.yml`) does this automatically on push to `main`, including committing generated files.
- Commit generated files (`manifest.json`, `manifest.en.json`, `dirs.en.json`, `README.md`, `en/README.md`, and `en/` translations) alongside note changes.
- Never edit `translatedFrom` in `en/` files; it is the source SHA-256 and controls whether a re-translation is triggered.
- Anchor slugs are duplicated in `assets/js/app.js` (`slugify`) and `scripts/update-readme.py` (`slugify`). Any change must be mirrored in both, or README/TOC links break.
- Excluded dirs/files are duplicated across `assets/js/config.js`, `scripts/update-readme.py`, `scripts/translate-notes.py`, and `scripts/build-manifest.ps1`. Keep them consistent; the top-level `en/` directory must stay excluded from Chinese note scans.
- English files mirror Chinese paths under `en/` and keep relative `.md` links unchanged; the site maps a Chinese route to `en/...` automatically.
- English folder labels: `dirs.en.json` is authoritative (generated + manually editable), with `assets/js/i18n.js` (`dirs`), `scripts/translate-notes.py` (`DEFAULT_DIR_LABELS`), and `scripts/update-readme.py` (`DIR_LABELS_EN`) as fallbacks. Keep the fallbacks reasonable, but prefer fixing labels in `dirs.en.json`.
- `.nojekyll` must stay: GitHub Pages would otherwise run Jekyll and break `.md` paths.
- Home pages are fixed to `README.md` (Chinese) and `en/README.md` (English) via `config.js` `home` / `homeEn`; they are excluded from the sidebars.
- `index.html` sets the theme before CSS loads; preserve that inline script to avoid dark-mode flash.
- Keep code comments in the existing Chinese style; user-facing strings need both zh and en entries.
