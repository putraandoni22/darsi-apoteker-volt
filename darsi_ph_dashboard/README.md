# DARSI Dashboard

Aplikasi **Next.js** untuk operasional apoteker RSI: dispensing, validasi resep, stok, admin, portal pasien, dan antarmuka chat yang terhubung ke folder `../darsi_ph_chatbot`.

## Modul utama

| Rute | Peran |
|------|--------|
| `/apoteker/dispensing` | Antrean & penyerahan obat |
| `/apoteker/validasi-resep` | Validasi resep |
| `/apoteker/monitoring-stok` | Monitoring stok |
| `/admin/*` | Admin sistem & knowledge base |
| `/pasien/*` | Portal pasien |
| `/chat` | Asisten obat (via chatbot) |

## Setup

```bash
npm install
```

Buat `darsi_ph_dashboard/.env.local` (tidak di-commit), contoh variabel:

```env
NEXT_PUBLIC_VOLTAGENT_URL=http://localhost:1337

DARSI_DB_HOST=...
DARSI_DB_PORT=5432
DARSI_DB_DATABASE=hospital_cs
DARSI_DB_USERNAME=postgres
DARSI_DB_PASSWORD=...
DARSI_DISPENSING_TABLE=darsi_ph_dispensing
```

Data demo lokal: `data/` (JSON/SQLite). Database dispensing produksi memakai PostgreSQL (`lib/db/pg.ts`).

## Perintah

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Dev server (port 3000) |
| `npm run build` | Build production |
| `npm run lint` | Cek Biome |

Dari **root repo**: `npm run seed:master-obat` menjalankan skrip di `darsi_ph_dashboard/scripts/`.
