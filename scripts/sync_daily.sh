#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[SYNC] Starting daily sync at $(date -Iseconds)"

# 1) Update e-Fornas source data
python3 scripts/scrape_efornas.py

# 2) Rebuild vector indexes
npm run init-efornas
npm run init-embeddings

echo "[SYNC] Finished daily sync at $(date -Iseconds)"
echo "[SYNC] Tip: run with cron, e.g. 0 2 * * * /bin/bash /path/to/scripts/sync_daily.sh"
