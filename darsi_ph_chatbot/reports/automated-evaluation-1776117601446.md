# Automated Evaluation Report - AI Agent Kesehatan

- Generated At: 2026-04-13T22:00:01.440Z
- API URL: dry-run://local
- Total Scenarios: 5
- Average F1: 0.807189
- Average Precision: 0.677652
- Average Recall: 1
- Average Accuracy: 0.677652
- Average Pseudo-Perplexity: 16.572422
- Exact Match Rate: 0
- Tool Calling Pass Rate: 1
- ICD-10 Pass Rate: 1

## Ringkasan Tabel
| ID | F1 | Accuracy | Pseudo-Perplexity | Tool Calling | ICD-10 | Waktu (ms) |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| SCN-001 | 0.8261 | 0.7037 | 17.938 | PASS (search_icd_code, recommend-medicines, search-medicines) | PASS (I10) | 0 |
| SCN-002 | 0.8095 | 0.68 | 16.3516 | PASS (check_medication_interaction, search-medicines) | PASS (N/A) | 0 |
| SCN-003 | 0.7647 | 0.619 | 14.3917 | PASS (search-efornas) | PASS (N/A) | 0 |
| SCN-004 | 0.8462 | 0.7333 | 19.407 | PASS (search_icd_code, recommend-medicines, search-medicines) | PASS (E11) | 0 |
| SCN-005 | 0.7895 | 0.6522 | 14.7739 | PASS (get-live-system-status) | PASS (N/A) | 0 |

## Detail Per Skenario
## SCN-001
- Patient ID: pasien-rsi-1001
- Question: Tolong berikan kode ICD-10 untuk hipertensi primer dan rekomendasi obat awal.
- API: dry-run://local
- Tool Calling: PASS
- Called Tools: search_icd_code, recommend-medicines, search-medicines
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: I10
- ICD Expected: I10
- F1: 0.826087
- Precision: 0.703704
- Recall: 1
- Accuracy: 0.703704
- Exact Match: false
- Pseudo-Perplexity: 17.937973
- Cross-Entropy: 4.164945
- Generated Answer:
```text
Kode ICD-10 yang relevan adalah I10 (Essential primary hypertension). Sertakan validasi klinis serta rekomendasi obat berbasis data RSI/e-Fornas.

[DRY RUN] Jawaban ini disimulasikan dari expected answer.
```

## SCN-002
- Patient ID: pasien-rsi-1002
- Question: Saya sedang minum Warfarin dan Aspirin. Tolong cek ada interaksi berbahaya atau tidak.
- API: dry-run://local
- Tool Calling: PASS
- Called Tools: check_medication_interaction, search-medicines
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: -
- ICD Expected: -
- F1: 0.809524
- Precision: 0.68
- Recall: 1
- Accuracy: 0.68
- Exact Match: false
- Pseudo-Perplexity: 16.351596
- Cross-Entropy: 4.03136
- Generated Answer:
```text
Jawaban harus memuat skrining interaksi Warfarin + Aspirin, peringatan klinis bila ada risiko perdarahan, dan arahan verifikasi apoteker/dokter.

[DRY RUN] Jawaban ini disimulasikan dari expected answer.
```

## SCN-003
- Patient ID: pasien-rsi-1003
- Question: Apakah Parasetamol tersedia di e-Fornas dan bagaimana restriksinya?
- API: dry-run://local
- Tool Calling: PASS
- Called Tools: search-efornas
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: -
- ICD Expected: -
- F1: 0.764706
- Precision: 0.619048
- Recall: 1
- Accuracy: 0.619048
- Exact Match: false
- Pseudo-Perplexity: 14.391729
- Cross-Entropy: 3.847168
- Generated Answer:
```text
Jawaban harus menyebut hasil pencarian e-Fornas untuk Parasetamol, termasuk ketersediaan/kelas terapi/restriksi jika ada.

[DRY RUN] Jawaban ini disimulasikan dari expected answer.
```

## SCN-004
- Patient ID: pasien-rsi-1004
- Question: Berikan kode ICD untuk diabetes melitus tipe 2 dan contoh terapi oral yang sering dipakai.
- API: dry-run://local
- Tool Calling: PASS
- Called Tools: search_icd_code, recommend-medicines, search-medicines
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: E11, E11.9
- ICD Expected: E11
- F1: 0.846154
- Precision: 0.733333
- Recall: 1
- Accuracy: 0.733333
- Exact Match: false
- Pseudo-Perplexity: 19.40696
- Cross-Entropy: 4.278502
- Generated Answer:
```text
Kode ICD-10 relevan untuk diabetes melitus tipe 2 adalah E11 (atau turunannya seperti E11.9), disertai opsi terapi oral yang sesuai data internal.

[DRY RUN] Jawaban ini disimulasikan dari expected answer.
```

## SCN-005
- Patient ID: pasien-rsi-1005
- Question: Bagaimana status operasional live untuk stok obat dan antrian dispensing hari ini?
- API: dry-run://local
- Tool Calling: PASS
- Called Tools: get-live-system-status
- Missing Tools: -
- ICD-10 Check: PASS
- ICD Generated: -
- ICD Expected: -
- F1: 0.789474
- Precision: 0.652174
- Recall: 1
- Accuracy: 0.652174
- Exact Match: false
- Pseudo-Perplexity: 14.773851
- Cross-Entropy: 3.884974
- Generated Answer:
```text
Jawaban harus menampilkan ringkasan status operasional live (stok/antrian/dispensing) atau menyatakan keterbatasan data live secara jelas.

[DRY RUN] Jawaban ini disimulasikan dari expected answer.
```
