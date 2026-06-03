export type EvaluationScenario = {
  id: string;
  patientId: string;
  question: string;
  expectedAnswer: string;
  expectedTools: string[];
  expectedIcdCodes?: string[];
};

export const evaluationScenarios: EvaluationScenario[] = [
  {
    id: "SCN-001",
    patientId: "pasien-rsi-1001",
    question: "Tolong berikan kode ICD-10 untuk hipertensi primer dan rekomendasi obat awal.",
    expectedAnswer:
      "Kode ICD-10 yang relevan adalah I10 (Essential primary hypertension). Sertakan validasi klinis serta rekomendasi obat berbasis data RSI/e-Fornas.",
    expectedTools: ["search_icd_code", "recommend-medicines", "search-medicines"],
    expectedIcdCodes: ["I10"],
  },
  {
    id: "SCN-002",
    patientId: "pasien-rsi-1002",
    question:
      "Saya sedang minum Warfarin dan Aspirin. Tolong cek ada interaksi berbahaya atau tidak.",
    expectedAnswer:
      "Jawaban harus memuat skrining interaksi Warfarin + Aspirin, peringatan klinis bila ada risiko perdarahan, dan arahan verifikasi apoteker/dokter.",
    expectedTools: ["check_medication_interaction", "search-medicines"],
  },
  {
    id: "SCN-003",
    patientId: "pasien-rsi-1003",
    question: "Apakah Parasetamol tersedia di e-Fornas dan bagaimana restriksinya?",
    expectedAnswer:
      "Jawaban harus menyebut hasil pencarian e-Fornas untuk Parasetamol, termasuk ketersediaan/kelas terapi/restriksi jika ada.",
    expectedTools: ["search-efornas"],
  },
  {
    id: "SCN-004",
    patientId: "pasien-rsi-1004",
    question: "Berikan kode ICD untuk diabetes melitus tipe 2 dan contoh terapi oral yang sering dipakai.",
    expectedAnswer:
      "Kode ICD-10 relevan untuk diabetes melitus tipe 2 adalah E11 (atau turunannya seperti E11.9), disertai opsi terapi oral yang sesuai data internal.",
    expectedTools: ["search_icd_code", "recommend-medicines", "search-medicines"],
    expectedIcdCodes: ["E11"],
  },
  {
    id: "SCN-005",
    patientId: "pasien-rsi-1005",
    question: "Bagaimana status operasional live untuk stok obat dan antrian dispensing hari ini?",
    expectedAnswer:
      "Jawaban harus menampilkan ringkasan status operasional live (stok/antrian/dispensing) atau menyatakan keterbatasan data live secara jelas.",
    expectedTools: ["get-live-system-status"],
  },
];