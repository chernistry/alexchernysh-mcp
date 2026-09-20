# Bundled fonts

The pages load no third-party resource, so the three faces they use ship
inside the Worker as Data modules (`wrangler.toml` `[[rules]] type = "Data"`)
and are served from `/fonts/*` with `immutable`.

All three are latin-subset, single-weight static instances of Google Fonts
families, under the SIL Open Font License 1.1.

| File | Family | Weight | Subset | Bytes | SHA-256 |
|---|---|---|---|---|---|
| `cormorant-garamond-600.woff2` | Cormorant Garamond | 600 | latin | 23396 | `ae062b6d5ae308e7edf61b28b07b9984bbb6e961b1f34d9b2c2f4389c33f21ea` |
| `manrope-400.woff2` | Manrope | 400 | latin | 14108 | `849290ef12a2eeb9af5c11924120d11aa4ae8b435ed3347d7fc8bc240c293ca3` |
| `manrope-600.woff2` | Manrope | 600 | latin | 14172 | `f7ac6258da20ab7541939b59851155753d1d24f1b30cbcb949077a3faa3d1593` |

## Provenance

Fetched 2026-09-20 from the `@fontsource` mirrors of the upstream Google Fonts
binaries, which publish one static file per weight and subset:

```
curl -sSL -o fonts/cormorant-garamond-600.woff2 \
  https://cdn.jsdelivr.net/npm/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2
curl -sSL -o fonts/manrope-400.woff2 \
  https://cdn.jsdelivr.net/npm/@fontsource/manrope/files/manrope-latin-400-normal.woff2
curl -sSL -o fonts/manrope-600.woff2 \
  https://cdn.jsdelivr.net/npm/@fontsource/manrope/files/manrope-latin-600-normal.woff2
```

The Google Fonts CSS API is not used as the source for Manrope: that family is
published as a variable font, so `wght@400` and `wght@600` resolve to the same
multi-weight file. Two copies of one variable font would double the bundled
bytes for no rendering benefit, so the per-weight static instances are used
instead. Cormorant Garamond is taken from the same mirror for consistency; its
bytes match the weight-600 latin slice the Google CSS API serves to within the
mirror's own repack.

## Licence

SIL Open Font License 1.1 — <https://openfontlicense.org>.

- Cormorant Garamond: Copyright 2015 The Cormorant Project Authors.
- Manrope: Copyright 2018 The Manrope Project Authors.

## Replacing a file

Re-download, then update the bytes and the hash in the table above.
`test/fonts.test.ts` asserts every file is served as `font/woff2`, is
`immutable`, starts with the `wOF2` signature, and stays under 60 KB.
