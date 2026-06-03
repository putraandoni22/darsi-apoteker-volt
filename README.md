# DARSI Apoteker (Volt)

Sistem asisten apoteker RSI Surabaya — terdiri dari **chatbot AI** dan **dashboard web** yang berjalan terpisah tetapi saling terhubung.

## Struktur folder

```
darsi-apoteker-volt/
├── darsi_ph_chatbot/    # Backend AI (VoltAgent, Ollama, RAG obat, tools)
├── darsi_ph_dashboard/  # Frontend Next.js (dispensing, admin, pasien, chat UI)
├── docker-compose.yml
├── run-darsi.sh         # Jalankan chatbot + dashboard sekaligus
└── package.json         # Perintah ringkas dari root repo
```

| Folder | Fungsi | Port default |
|--------|--------|----------------|
| `darsi_ph_chatbot/` | API agent & `/api/chat` | `1337` |
| `darsi_ph_dashboard/` | UI apoteker, API demo, auth | `3000` |

## Persiapan

```bash
# Install dependensi kedua bagian
npm run install:all

# Chatbot: salin env
cp darsi_ph_chatbot/.env.example darsi_ph_chatbot/.env
# Edit darsi_ph_chatbot/.env (Postgres, Ollama, dll.)

# Dashboard: buat .env.local (DB dispensing, SMTP, dll.)
# Lihat darsi_ph_dashboard/.env.example
```

## Menjalankan

**Keduanya sekaligus (disarankan):**

```bash
./run-darsi.sh
# atau
npm run dev
```

**Hanya chatbot:**

```bash
cd darsi_ph_chatbot && npm run dev
```

**Hanya dashboard:**

```bash
cd darsi_ph_dashboard && npm run dev
```

Buka dashboard: http://localhost:3000  
Chatbot API: http://localhost:1337/api/chat

## Dokumentasi per modul

- [darsi_ph_chatbot/README.md](darsi_ph_chatbot/README.md) — embedding, evaluasi, sinkron data obat
- [darsi_ph_dashboard/README.md](darsi_ph_dashboard/README.md) — modul apoteker, admin, pasien
