# DARSI Chatbot

Backend **AI apoteker** berbasis [VoltAgent](https://voltagent.dev): chat, tools (obat kronis, e-Fornas, ICD-10, stok), memori percakapan, dan embedding LanceDB.

## Isi folder

| Path | Keterangan |
|------|------------|
| `src/` | Agent, tools, embedding, memory |
| `data/` | CSV obat kronis, e-Fornas, FAQ, dataset evaluasi |
| `scripts/` | Scrape, evaluasi, sync harian |
| `reports/` | Laporan hasil evaluasi otomatis |

## Setup

```bash
npm install
cp .env.example .env
# Isi kredensial Postgres & Ollama di .env
```

**Embedding (sekali / rebuild):**

```bash
./setup-embeddings.sh
```

## Perintah

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Development server (port 1337) |
| `npm run build` / `npm start` | Production build |
| `npm run init-embeddings` | Index obat kronis → LanceDB |
| `npm run init-efornas` | Index e-Fornas |
| `npm run scrape-efornas` | Unduh CSV e-Fornas |
| `npm run sync:daily` | Sync harian (cron) |
| `npm run eval:apoteker` | Evaluasi skenario |

Dashboard memanggil chatbot lewat `NEXT_PUBLIC_VOLTAGENT_URL` (default `http://localhost:1337`).
