# app/ — Mercado BR frontend

Next.js 16 static export. Consumes JSON artifacts published to
`https://<user>.github.io/applied_finance/data/*.json` (and Parquet for the
future portfolio page).

## Dev

```bash
pnpm install
pnpm dev   # http://localhost:3000
```

For local dev against artifacts you haven't deployed, drop the JSON files into
`app/public/data/`.

## Build

```bash
pnpm build  # outputs to app/out/
```

The `GH_PAGES_BASE` env var is set in CI to `/applied_finance` so links work
under the repo-scoped Pages URL.

## Stack

- Next.js 16 (App Router, `output: 'export'`)
- React 19
- Tailwind v4 (CSS-first, `@import "tailwindcss"`)
- Recharts (charts)
- Vitest (unit)
- Playwright (E2E, optional)
