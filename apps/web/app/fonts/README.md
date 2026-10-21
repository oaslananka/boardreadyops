# Pinned local web fonts (Issue #1157)

The root layout imports these self-hosted WOFF2 files via `next/font/local` to avoid
fetching Google Fonts stylesheets during Linux and Windows production builds.
The font-family stacks and CSS variable names stay in `apps/web/app/globals.css`.

All files were extracted **without modification** from the pinned Fontsource npm
archives shown below. Redistribution is permitted by their accompanying SIL Open
Font License 1.1 copies in `licenses/`.

| Local file | Upstream npm archive (exact version) | SHA-256 of WOFF2 | License |
| --- | --- | --- | --- |
| `inter-latin-variable-normal.woff2` | `@fontsource-variable/inter@5.3.0`, `files/inter-latin-wght-normal.woff2` | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` | `licenses/INTER-OFL.txt` |
| `jetbrains-mono-latin-variable-normal.woff2` | `@fontsource-variable/jetbrains-mono@5.3.0`, `files/jetbrains-mono-latin-wght-normal.woff2` | `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e` | `licenses/JETBRAINS-MONO-OFL.txt` |
| `instrument-serif-latin-400-normal.woff2` | `@fontsource/instrument-serif@5.3.0`, `files/instrument-serif-latin-400-normal.woff2` | `5eb09b5ac0e28b67c2f041c8ba6d244604ca0c0980d65912ab2d47fed84ddc31` | `licenses/INSTRUMENT-SERIF-OFL.txt` |

These files cover the same Latin subset requested by the prior `next/font/google`
configuration. Inter remains available at 400/500/600/700, JetBrains Mono at
400/500/700, and Instrument Serif at 400. No npm/runtime dependency was added.
The file names and hashes intentionally make asset updates reviewable.
