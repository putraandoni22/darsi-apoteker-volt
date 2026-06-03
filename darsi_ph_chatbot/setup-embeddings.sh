#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-snowflake-arctic-embed}"
RSI_CSV="data/DAFTAR OBAT KRONIS RSI SURABAYA.csv"
EFORNAS_CSV="data/efornas_obat_lengkap.csv"

echo "==============================================================="
echo "DARSI Apoteker - Embedding Setup"
echo "==============================================================="
echo ""

echo "STEP 1: Checking prerequisites"
echo "--------------------------------"

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Node.js is required but not found.${NC}"
  exit 1
fi
echo "Node.js: $(node -v)"

if ! command -v curl >/dev/null 2>&1; then
  echo -e "${RED}curl is required but not found.${NC}"
  exit 1
fi

if ! curl -fsS "${OLLAMA_BASE_URL}/api/tags" >/tmp/darsi-ollama-tags.json; then
  echo -e "${RED}Cannot reach Ollama at ${OLLAMA_BASE_URL}.${NC}"
  echo "Start Ollama first, then re-run this script."
  exit 1
fi
echo "Ollama endpoint reachable: ${OLLAMA_BASE_URL}"

if grep -q "\"name\"[[:space:]]*:[[:space:]]*\"${EMBEDDING_MODEL}" /tmp/darsi-ollama-tags.json; then
  echo "Embedding model found: ${EMBEDDING_MODEL}"
else
  echo -e "${YELLOW}Model ${EMBEDDING_MODEL} not listed in local Ollama models.${NC}"
  echo "Run: ollama pull ${EMBEDDING_MODEL}"
  exit 1
fi

echo ""
echo "STEP 2: Checking data files"
echo "--------------------------------"

if [[ -f "$RSI_CSV" ]]; then
  echo "RSI CSV found: $RSI_CSV ($(wc -l < "$RSI_CSV") lines)"
else
  echo -e "${RED}Missing RSI CSV: $RSI_CSV${NC}"
  exit 1
fi

if [[ -f "$EFORNAS_CSV" ]]; then
  echo "e-Fornas CSV found: $EFORNAS_CSV ($(wc -l < "$EFORNAS_CSV") lines)"
  INIT_EFORNAS="yes"
else
  echo -e "${YELLOW}e-Fornas CSV not found: $EFORNAS_CSV${NC}"
  echo "e-Fornas init will be skipped. You can generate CSV via: npm run scrape-efornas"
  INIT_EFORNAS="no"
fi

echo ""
echo "STEP 3: Checking existing vector database"
echo "--------------------------------"

if [[ -d ".voltagent/lancedb" ]]; then
  echo -e "${YELLOW}Existing vector DB detected (.voltagent/lancedb).${NC}"
  echo "Current size: $(du -sh .voltagent/lancedb | cut -f1)"
  read -r -p "Rebuild from scratch? (y/n) " REPLY
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then
    rm -rf .voltagent/lancedb
    echo "Existing vector DB removed."
  else
    echo "Keeping existing vector DB."
  fi
else
  echo "No existing vector DB found."
fi

echo ""
echo "STEP 4: Initializing embeddings"
echo "--------------------------------"

echo "Running RSI embedding initialization..."
npm run init-embeddings

if [[ "$INIT_EFORNAS" == "yes" ]]; then
  echo "Running e-Fornas embedding initialization..."
  npm run init-efornas
else
  echo "Skipping e-Fornas initialization."
fi

echo ""
echo "STEP 5: Verification"
echo "--------------------------------"

if [[ -d ".voltagent/lancedb" ]]; then
  echo -e "${GREEN}Vector DB is ready: .voltagent/lancedb${NC}"
  echo "Size: $(du -sh .voltagent/lancedb | cut -f1)"
  echo "Files: $(find .voltagent/lancedb -type f | wc -l)"
else
  echo -e "${RED}Vector DB directory was not created.${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}Setup complete.${NC}"
echo "Start backend: npm run dev"
echo "Run full stack launcher: ./run-darsi.sh"
