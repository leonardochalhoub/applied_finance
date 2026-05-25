#!/usr/bin/env bash
# sync-data — pull the latest CI-managed frontend artifacts from gh-pages
# into app/public/data/ so `pnpm dev` and `pnpm build` see the same data
# the deployed site uses.
#
# Why this script exists: app/public/data/*.{json,parquet} are gitignored
# (CI publishes them to gh-pages on every refresh-pipelines run; committing
# a snapshot would silently win over fresh CI data via Next.js's
# build-time fs reads — see commit 92a6bf1). Without this script, a fresh
# clone has no data, and a long-running clone keeps whatever stale copies
# happen to be in the working tree.
#
# `mclean_results.json` is preserved if it's tracked in HEAD — that's the
# hand-maintained override the McLean workflow relies on.

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
dest="$repo_root/app/public/data"

echo "→ fetching origin/gh-pages..."
git -C "$repo_root" fetch origin gh-pages --quiet

if ! git -C "$repo_root" rev-parse --verify origin/gh-pages > /dev/null 2>&1; then
  echo "✗ origin/gh-pages not found — has refresh-pipelines ever run?" >&2
  exit 1
fi

mkdir -p "$dest"

# Files to skip: mclean_results.json is repo-managed (override pattern).
# Everything else in gh-pages:data/ is CI-published and safe to overwrite.
mapfile -t files < <(
  git -C "$repo_root" ls-tree --name-only origin/gh-pages data/ \
    | grep -v '/$' \
    | grep -v 'mclean_results.json'
)

if [ "${#files[@]}" -eq 0 ]; then
  echo "✗ no files found in gh-pages:data/ — has refresh-pipelines published yet?" >&2
  exit 1
fi

echo "→ syncing ${#files[@]} files into $dest/"
for f in "${files[@]}"; do
  basename="${f#data/}"
  git -C "$repo_root" show "origin/gh-pages:$f" > "$dest/$basename"
done

# Quick sanity check on the headline artifact
if [ -f "$dest/kpis_per_ticker.json" ]; then
  python3 - "$dest/kpis_per_ticker.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
t = d.get("tickers", [])
print(f"✓ kpis_per_ticker.json: as_of={d.get('as_of')}  n_tickers={len(t)}")
PY
else
  echo "✓ synced (no kpis_per_ticker.json to summarize)"
fi
