#!/usr/bin/env python3
"""
Scraper untuk mengambil data lengkap obat dari e-Fornas (https://e-fornas.kemkes.go.id)
Menggunakan API JSON internal, TIDAK perlu Selenium/browser.

Output: data/efornas_obat_lengkap.csv
"""

import csv
import json
import os
import sys
import time
import requests
from typing import Any

BASE_URL = "https://e-fornas.kemkes.go.id/api/daftar-obat"
LETTERS = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "efornas_obat_lengkap.csv")
PROGRESS_FILE = os.path.join(OUTPUT_DIR, "efornas_progress.json")

# Rate limiting
DELAY_BETWEEN_REQUESTS = 0.5  # seconds - be respectful to the server

# CSV columns
CSV_COLUMNS = [
    "id_obat",
    "nama_obat",
    "nama_obat_internasional",
    "kelas_terapi",
    "sub_kelas_terapi",
    "sub_sub_kelas_terapi",
    "sub_sub_sub_kelas_terapi",
    "sediaan",
    "kekuatan",
    "satuan",
    "fpktp",
    "fpktl",
    "pp",
    "prb",
    "oen",
    "program",
    "kanker",
    "komposisi",
    "restriksi_kelas_terapi",
    "restriksi_sub_kelas_terapi",
    "restriksi_sub_sub_kelas_terapi",
    "restriksi_sub_sub_sub_kelas_terapi",
    "restriksi_obat",
    "restriksi_sediaan",
    "peresepan_maksimal",
]

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) DarsiApoteker/1.0",
    "Accept": "application/json",
})


def fetch_json(params: dict) -> Any:
    """Fetch JSON from e-Fornas API with retry logic."""
    for attempt in range(3):
        try:
            resp = session.get(BASE_URL, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if data.get("status") == 200:
                return data.get("data", [])
            print(f"  [WARN] API returned status {data.get('status')}: {data.get('message')}")
            return []
        except requests.exceptions.RequestException as e:
            print(f"  [RETRY {attempt+1}/3] Request error: {e}")
            time.sleep(2 ** attempt)
    print("  [ERROR] Failed after 3 attempts")
    return []


def fetch_drugs_by_letter(letter: str) -> list[dict]:
    """Fetch semua obat yang dimulai dengan huruf tertentu."""
    print(f"\n📋 Mengambil daftar obat huruf [{letter}]...")
    data = fetch_json({"type": "byname", "value": letter})
    print(f"   Ditemukan {len(data)} obat")
    return data


def fetch_drug_detail(id_obat: int) -> list[dict]:
    """Fetch detail sediaan obat berdasarkan ID."""
    return fetch_json({"type": "byidobat", "value": str(id_obat)})


def fetch_drug_sks(id_obat: int, kekuatan: str, kode_satuan: str, kode_sediaan: str) -> list[dict]:
    """Fetch data SKS (kelas terapi, restriksi, dll) untuk obat tertentu."""
    return fetch_json({
        "type": "obatsks",
        "_id_obat": str(id_obat),
        "_kekuatan": kekuatan,
        "_kode_satuan": kode_satuan,
        "_kode_sediaan": kode_sediaan,
    })


def safe_str(val: Any) -> str:
    """Convert value to string safely."""
    if val is None:
        return ""
    if isinstance(val, bool):
        return "Ya" if val else "Tidak"
    return str(val).strip()


def load_progress() -> dict:
    """Load scraping progress to allow resume."""
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r") as f:
            return json.load(f)
    return {"completed_letters": [], "total_drugs": 0, "total_rows": 0}


def save_progress(progress: dict):
    """Save scraping progress."""
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)


def scrape_all():
    """Main scraping function."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    progress = load_progress()
    completed = set(progress.get("completed_letters", []))

    # Determine if we need to write header
    file_exists = os.path.exists(OUTPUT_FILE) and len(completed) > 0
    mode = "a" if file_exists else "w"

    total_drugs = progress.get("total_drugs", 0)
    total_rows = progress.get("total_rows", 0)

    print("=" * 60)
    print("  SCRAPER DATA OBAT e-FORNAS")
    print("  https://e-fornas.kemkes.go.id/guest/daftar-obat")
    print("=" * 60)

    if completed:
        print(f"\n⏩ Melanjutkan dari progress sebelumnya...")
        print(f"   Huruf selesai: {', '.join(sorted(completed))}")
        print(f"   Total obat: {total_drugs}, Total baris: {total_rows}")

    remaining = [l for l in LETTERS if l not in completed]
    if not remaining:
        print("\n✅ Semua huruf sudah selesai di-scrape!")
        return

    print(f"\n📌 Huruf yang akan di-scrape: {', '.join(remaining)}")

    with open(OUTPUT_FILE, mode, newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=CSV_COLUMNS)
        if mode == "w":
            writer.writeheader()

        for letter in remaining:
            drugs = fetch_drugs_by_letter(letter)
            letter_rows = 0

            for idx, drug in enumerate(drugs):
                id_obat = drug.get("_id_obat")
                nama = drug.get("_nama_obat", "")
                nama_int = drug.get("_nama_obat_internasional", "")

                print(f"   [{idx+1}/{len(drugs)}] {nama}...", end="", flush=True)
                time.sleep(DELAY_BETWEEN_REQUESTS)

                # Step 1: Get sediaan detail
                details = fetch_drug_detail(id_obat)

                if not details:
                    # Write basic row even without detail
                    writer.writerow({
                        "id_obat": id_obat,
                        "nama_obat": nama,
                        "nama_obat_internasional": nama_int,
                    })
                    letter_rows += 1
                    print(" (no detail)")
                    continue

                # Step 2: For each sediaan, get SKS data
                sks_fetched = False
                for detail in details:
                    kode_sediaan = detail.get("_kode_sediaan", "")
                    kekuatan = detail.get("_kekuatan", "")
                    kode_satuan = detail.get("_kode_satuan", "")

                    time.sleep(DELAY_BETWEEN_REQUESTS)
                    sks_list = fetch_drug_sks(id_obat, kekuatan, kode_satuan, kode_sediaan)

                    if sks_list:
                        for sks in sks_list:
                            row = {
                                "id_obat": id_obat,
                                "nama_obat": safe_str(sks.get("_nama_obat", nama)),
                                "nama_obat_internasional": nama_int,
                                "kelas_terapi": safe_str(sks.get("_kelas_terapi")),
                                "sub_kelas_terapi": safe_str(sks.get("_sub_kelas_terapi")),
                                "sub_sub_kelas_terapi": safe_str(sks.get("_sub_sub_kelas_terapi")),
                                "sub_sub_sub_kelas_terapi": safe_str(sks.get("_sub_sub_sub_kelas_terapi")),
                                "sediaan": safe_str(sks.get("_sediaan", detail.get("_sediaan"))),
                                "kekuatan": safe_str(sks.get("_kekuatan", kekuatan)),
                                "satuan": safe_str(sks.get("_satuan", detail.get("_satuan"))),
                                "fpktp": safe_str(sks.get("_fpktp")),
                                "fpktl": safe_str(sks.get("_fpktl")),
                                "pp": safe_str(sks.get("_pp")),
                                "prb": safe_str(sks.get("_prb")),
                                "oen": safe_str(sks.get("_oen")),
                                "program": safe_str(sks.get("_program")),
                                "kanker": safe_str(sks.get("_kanker")),
                                "komposisi": safe_str(sks.get("_komposisi")),
                                "restriksi_kelas_terapi": safe_str(sks.get("_rkt0")),
                                "restriksi_sub_kelas_terapi": safe_str(sks.get("_rkt1")),
                                "restriksi_sub_sub_kelas_terapi": safe_str(sks.get("_rkt2")),
                                "restriksi_sub_sub_sub_kelas_terapi": safe_str(sks.get("_rkt3")),
                                "restriksi_obat": safe_str(sks.get("_restriksi_obat")),
                                "restriksi_sediaan": safe_str(sks.get("_restriksi_sediaan")),
                                "peresepan_maksimal": safe_str(sks.get("_peresepan_maksimal")),
                            }
                            writer.writerow(row)
                            letter_rows += 1
                        sks_fetched = True
                    else:
                        # Write sediaan detail without SKS
                        row = {
                            "id_obat": id_obat,
                            "nama_obat": nama,
                            "nama_obat_internasional": nama_int,
                            "sediaan": safe_str(detail.get("_sediaan")),
                            "kekuatan": safe_str(kekuatan),
                            "satuan": safe_str(detail.get("_satuan")),
                        }
                        writer.writerow(row)
                        letter_rows += 1

                if sks_fetched:
                    print(f" ✅ ({len(details)} sediaan)")
                else:
                    print(f" ⚠️ (no SKS data)")

            total_drugs += len(drugs)
            total_rows += letter_rows
            completed.add(letter)

            # Flush and save progress after each letter
            csvfile.flush()
            progress["completed_letters"] = sorted(completed)
            progress["total_drugs"] = total_drugs
            progress["total_rows"] = total_rows
            save_progress(progress)

            print(f"\n   ✅ Huruf [{letter}] selesai: {len(drugs)} obat, {letter_rows} baris")
            print(f"   📊 Total kumulatif: {total_drugs} obat, {total_rows} baris")

    print("\n" + "=" * 60)
    print(f"  ✅ SELESAI!")
    print(f"  📊 Total: {total_drugs} obat, {total_rows} baris data")
    print(f"  📁 Output: {OUTPUT_FILE}")
    print("=" * 60)

    # Cleanup progress file
    if os.path.exists(PROGRESS_FILE):
        os.remove(PROGRESS_FILE)


if __name__ == "__main__":
    try:
        scrape_all()
    except KeyboardInterrupt:
        print("\n\n⚠️ Dihentikan oleh user. Progress tersimpan, jalankan ulang untuk melanjutkan.")
        sys.exit(0)
