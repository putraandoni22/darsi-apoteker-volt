# Automated Evaluation Report - AI Agent Kesehatan

- Generated At: 2026-04-13T21:59:11.123Z
- API URL: http://localhost:1337/api/chat
- Total Scenarios: 5
- Average F1: 0.083775
- Average Precision: 0.046292
- Average Recall: 0.468182
- Average Accuracy: 0
- Average Pseudo-Perplexity: 97.821106
- Exact Match Rate: 0
- Tool Calling Pass Rate: 1
- ICD-10 Pass Rate: 0.8

## Ringkasan Tabel
| ID | F1 | Accuracy | Pseudo-Perplexity | Tool Calling | ICD-10 | Waktu (ms) |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| SCN-001 | 0.1229 | 0 | 84.641 | PASS (search_icd_code, search-medicines, recommend-medicines) | PASS (I10) | 6691 |
| SCN-002 | 0.1127 | 0 | 97.596 | PASS (search-medicines, check_medication_interaction) | PASS (N/A) | 3272 |
| SCN-003 | 0.0377 | 0 | 75.0608 | PASS (search-efornas) | PASS (N/A) | 1416 |
| SCN-004 | 0.0958 | 0 | 130.8569 | PASS (search_icd_code, search-medicines, recommend-medicines) | FAIL (Tidak ada kecocokan dari kode yang diharapkan: E11) | 670 |
| SCN-005 | 0.0498 | 0 | 100.9509 | PASS (search_icd_code, get-live-system-status) | PASS (N/A) | 434 |

## Detail Per Skenario
## SCN-001
- Patient ID: pasien-rsi-1001
- Question: Tolong berikan kode ICD-10 untuk hipertensi primer dan rekomendasi obat awal.
- API: http://localhost:1337/api/chat
- Tool Calling: PASS
- Called Tools: search_icd_code, search-medicines, recommend-medicines
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: I10
- ICD Expected: I10
- F1: 0.122905
- Precision: 0.06875
- Recall: 0.578947
- Accuracy: 0
- Exact Match: false
- Pseudo-Perplexity: 84.640998
- Cross-Entropy: 6.403285
- Generated Answer:
```text
Mapping kondisi "hipertensi primer" ke opsi terapi dari data internal RSI:

- ICD-10 paling relevan: I10 (Essential (primary) hypertension)
- Opsi terapi yang sesuai: DOPAMET 250MG, TELMISARTAN 40MG, 80MG, BERAPROST 20MCG, SILDENAFIL 20MG
- Peresepan obat RSI: [No. 65] DOPAMET 250MG: 90 TAB/BULAN; [No. 70] TELMISARTAN 40MG, 80MG: 30 TAB/BULAN; [No. 73] BERAPROST 20MCG: 90 TAB/BULAN; [No. 74] SILDENAFIL 20MG: 90 TAB/BULAN
- Data obat terkonfirmasi: 1) [No. 65] DOPAMET 250MG | Peresepan: 90 TAB/BULAN | Restriksi: hanya untuk hipertensi pada wanita hamil ; 2) [No. 70] TELMISARTAN 40MG, 80MG | Peresepan: 30 TAB/BULAN | Restriksi: Digunakan untuk hipertensi dengan nilai eGFR < 30 mL/menit/1,73 m2. ; 3) [No. 73] BERAPROST 20MCG | Peresepan: 90 TAB/BULAN | Restriksi: ANTIHIPERTENSI PULMONAL
- Nomor obat RSI: 65 (DOPAMET 250MG); 70 (TELMISARTAN 40MG, 80MG); 73 (BERAPROST 20MCG); 74 (SILDENAFIL 20MG)

Catatan klinis:
- Keputusan terapi dan dosis akhir tetap mengikuti penilaian dokter/apoteker.
Referensi internal: Rekomendasi Obat Berdasarkan Penyakit RSI; Database ICD10 RSI.
[Sumber: Data Internal RSI (Rekomendasi Penyakit RSI, ICD10 RSI)]
```

## SCN-002
- Patient ID: pasien-rsi-1002
- Question: Saya sedang minum Warfarin dan Aspirin. Tolong cek ada interaksi berbahaya atau tidak.
- API: http://localhost:1337/api/chat
- Tool Calling: PASS
- Called Tools: search-medicines, check_medication_interaction
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: -
- ICD Expected: -
- F1: 0.112676
- Precision: 0.064
- Recall: 0.470588
- Accuracy: 0
- Exact Match: false
- Pseudo-Perplexity: 97.595958
- Cross-Entropy: 6.608749
- Generated Answer:
```text
**[WARNING KLINIS]** Ditemukan potensi interaksi/kontraindikasi klinis penting.

Saya dapat membalas pertanyaan Anda sebagai Apoteker.

Ada interaksi berbahaya antara Warfarin dan Aspirin. Interaksi antara kedua obat ini dapat meningkatkan risiko perdarahan mayor. Sebagai alternatif, Anda dapat mempertimbangkan penggunaan antikoagulan lainnya selain warfarin. Pastikan untuk berdiskusi dengan dokter atau apoteker RSI Surabaya untuk merencanakan perubahan dosis yang tepat.

Catatan khusus: Saya sarankan Anda memindahkan obat-obatan yang berpotensi berguna ke tempatnya masing-masing untuk memastikan ketersediaan dan konsentrasi obat yang optimal.

Perlu diingat bahwa apoteker dapat memberikan konsultasi yang lebih rinci.

Nomor Obat RSI terkait: 24 (WARFARIN 2MG).

Catatan klinis: verifikasi klinis tetap diperlukan sesuai resep dokter/apoteker.

Referensi internal: Database Obat Kronis RSI Surabaya; Aturan Interaksi Obat Internal DARSI.
[Sumber: Data Internal RSI (Obat Kronis RSI, Aturan Interaksi)]
```

## SCN-003
- Patient ID: pasien-rsi-1003
- Question: Apakah Parasetamol tersedia di e-Fornas dan bagaimana restriksinya?
- API: http://localhost:1337/api/chat
- Tool Calling: PASS
- Called Tools: search-efornas
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: -
- ICD Expected: -
- F1: 0.037736
- Precision: 0.020548
- Recall: 0.230769
- Accuracy: 0
- Exact Match: false
- Pseudo-Perplexity: 75.060845
- Cross-Entropy: 6.229989
- Generated Answer:
```text
Ditemukan 4 hasil dari e-Fornas:

📌 parasetamol
   Nama Internasional: paracetamol
   Kelas Terapi: ANALGESIK, ANTIPIRETIK, ANTIINFLAMASI NON STEROID, ANTIPIRAI → ANALGESIK NON NARKOTIK
   Sediaan: DROPS 100 MILIGRAM / MILILITER
   Tersedia di: FKTP, FKTL, OEN
   Peresepan Maksimal: 1 btl/kasus.

📌 parasetamol
   Nama Internasional: paracetamol
   Kelas Terapi: ANALGESIK, ANTIPIRETIK, ANTIINFLAMASI NON STEROID, ANTIPIRAI → ANALGESIK NON NARKOTIK
   Sediaan: INFUS 10 MILIGRAM / MILILITER
   Tersedia di: FKTL
   Peresepan Maksimal: 3 btl/hari, maks. 3 hari.

📌 parasetamol
   Nama Internasional: paracetamol
   Kelas Terapi: ANALGESIK, ANTIPIRETIK, ANTIINFLAMASI NON STEROID, ANTIPIRAI → ANALGESIK NON NARKOTIK
   Sediaan: SIRUP 120 MILIGRAM / 5 MILILITER
   Tersedia di: FKTP, FKTL, OEN
   Peresepan Maksimal: 2 btl/kasus.

📌 parasetamol
   Nama Internasional: paracetamol
   Kelas Terapi: ANALGESIK, ANTIPIRETIK, ANTIINFLAMASI NON STEROID, ANTIPIRAI → ANALGESIK NON NARKOTIK
   Sediaan: TABLET 500 MILIGRAM
   Tersedia di: FKTP, FKTL, OEN
   Peresepan Maksimal: 180 tab/bulan.

Catatan klinis: verifikasi klinis tetap diperlukan sesuai resep dokter/apoteker.

Referensi internal: Database e-Fornas Kementerian Kesehatan RI.
[Sumber: Data Internal RSI (e-Fornas)]
```

## SCN-004
- Patient ID: pasien-rsi-1004
- Question: Berikan kode ICD untuk diabetes melitus tipe 2 dan contoh terapi oral yang sering dipakai.
- API: http://localhost:1337/api/chat
- Tool Calling: PASS
- Called Tools: search_icd_code, search-medicines, recommend-medicines
- Missing Tools: -
- ICD-10 Check: FAIL
- ICD Generated: E23.2
- ICD Expected: E11
- F1: 0.095808
- Precision: 0.051282
- Recall: 0.727273
- Accuracy: 0
- Exact Match: false
- Pseudo-Perplexity: 130.856868
- Cross-Entropy: 7.031846
- Generated Answer:
```text
Mapping kondisi "diabetes melitus tipe" ke opsi terapi dari data internal RSI:

- ICD-10 paling relevan: E23.2 (Diabetes insipidus)
- Opsi terapi yang sesuai: INSULIN BASAL (LANTUS, LEVEMIR, SANSULIN LONG), INSULIN  CAMPURAN (RYZODEG, HUMALOG MIX, NOVOMIX), SIMVASTATIN 10MG, 20MG
- Peresepan obat RSI: [No. 44] INSULIN BASAL (LANTUS, LEVEMIR, SANSULIN LONG): informasi belum tersedia; [No. 46] INSULIN  CAMPURAN (RYZODEG, HUMALOG MIX, NOVOMIX): informasi belum tersedia; [No. 84] SIMVASTATIN 10MG, 20MG: 30 TAB/BULAN
- Data obat terkonfirmasi: 1) [No. 44] INSULIN BASAL (LANTUS, LEVEMIR, SANSULIN LONG) | Peresepan: informasi belum tersedia | Restriksi: Pasien diabetes melitus tipe 2 yang sudah diberikan kombinasi metformin dosis optimal dan obat diabetes oral lainnya namun kadar glukosa darahnya belum terkendali (HbA1C > 7,5% atau gula darah rerata > 169 mg/dL). ATAU Pasien diabetes melitus tipe 2  dengan kadar HbA1C nya > 9%  disertai dengan gejala-gejala  dekompensasi metabolik. ; 2) [No. 46] INSULIN  CAMPURAN (RYZODEG, HUMALOG MIX, NOVOMIX) | Peresepan: informasi belum tersedia | Restriksi: Pasien diabetes melitus tipe 2 yang sudah diberikan kombinasi metformin dosis optimal dan obat diabetes oral lainnya namun kadar glukosa darahnya belum terkendali (HbA1C > 7,5% atau gula darah rerata > 169 mg/dL). ATAU Pasien diabetes melitus tipe 2  dengan kadar HbA1C nya > 9%  disertai dengan gejala-gejala  dekompensasi metabolik. ; 3) [No. 84] SIMVASTATIN 10MG, 20MG | Peresepan: 30 TAB/BULAN | Restriksi: kadar LDL > 160 mg/dL untuk pasien tanpa komplikasi diabetes melitus/PJK. kadar LDL > 130 mg/dL untuk pasien diabetes melitus,  pemeriksaan laboratorium LDL dilampirkan setiap 6 bulan Pasien ASCVD (pasca PCI, CABG, stroke iskemi dan/atau PAD, pascainfark) yang dibuktikan dengan EKG atau MSCT atau riwayat angiografi. Target LDL adalah ≤ 70 mg/dL, yang harus diperiksa setiap 6 bulan.
- Nomor obat RSI: 44 (INSULIN BASAL (LANTUS, LEVEMIR, SANSULIN LONG)); 46 (INSULIN  CAMPURAN (RYZODEG, HUMALOG MIX, NOVOMIX)); 84 (SIMVASTATIN 10MG, 20MG)

Catatan klinis:
- Keputusan terapi dan dosis akhir tetap mengikuti penilaian dokter/apoteker.
Referensi internal: Database ICD10 RSI.
[Sumber: Data Internal RSI (ICD10 RSI)]
```

## SCN-005
- Patient ID: pasien-rsi-1005
- Question: Bagaimana status operasional live untuk stok obat dan antrian dispensing hari ini?
- API: http://localhost:1337/api/chat
- Tool Calling: PASS
- Called Tools: search_icd_code, get-live-system-status
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: B12
- ICD Expected: -
- F1: 0.049751
- Precision: 0.026882
- Recall: 0.333333
- Accuracy: 0
- Exact Match: false
- Pseudo-Perplexity: 100.950861
- Cross-Entropy: 6.657509
- Generated Answer:
```text
STATUS OPERASIONAL APOTEKER (LIVE)

[MONITORING STOK]
- Total item: 3
- Total unit: 81
- Aman: 2
- Menipis: 1
- Kritis: 0
- Prioritas stok rendah:
  • KRN-0023 | VITAMIN B12 | stok 10 | status menipis

[STATUS DISPENSING / PENYERAHAN]
- Total order: 3
- Menunggu validasi resep: 0
- Menunggu pembayaran (antrian): 0
- Siap diracik: 0
- Sedang diracik: 0
- Siap diserahkan: 0
- Sudah diserahkan: 3
- Dibatalkan: 0
- Belum diserahkan: 0
- Tidak ada order dispensing aktif pada filter saat ini.
- Aktivitas transaksi terbaru:
  • 2026-04-13T16:21:16.211Z | dsp-58712f4e | pasien 2 | VITAMIN B12 | resep RSP-20260413-00001 | workflow diserahkan | bayar lunas
  • 2026-04-13T08:39:35.650Z | dsp-825ab4b8 | Pasien 1 | air steril untuk injeksi | resep RSP-20260411-00002 | workflow diserahkan | bayar lunas
  • 2026-04-12T09:38:45.806Z | dsp-5c02cdf0 | Pasien 1 | air steril untuk injeksi | resep RSP-20260411-00001 | workflow diserahkan | bayar lunas

[STATUS PEMBAYARAN]
- Menunggu pembayaran: 0
- Lunas: 3
- Gagal: 0
- Dibatalkan: 0
- Refund: 0
- Tidak ada order yang menunggu pembayaran pada filter saat ini.

Catatan klinis: verifikasi klinis tetap diperlukan sesuai resep dokter/apoteker.

Referensi internal: Sistem Operasional Live Apotek RSI.
[Sumber: Data Internal RSI (Operasional Live)]
```
