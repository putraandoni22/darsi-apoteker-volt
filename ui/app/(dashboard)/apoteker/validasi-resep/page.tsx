"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DemoPrescriptionValidationResult } from "@/lib/demo/types";

interface PrescriptionLookupItem {
  nomorObat: string;
  medicineName: string;
  dosage: string;
  quantity: number;
  keteranganObat: string;
}

interface PrescriptionLookup {
  nomorRM: string;
  nomorPeresepan: string;
  patientName: string;
  doctorName: string;
  items: PrescriptionLookupItem[];
}

interface PrescriptionLookupResponse {
  prescription?: PrescriptionLookup;
  error?: string;
}

function inferFrequencyFromDosage(rawDosage: string): string {
  const normalized = rawDosage.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  const compact = normalized.replace(/\s+/g, "");
  const fullMatch = compact.match(/\d+x\d+/);
  if (fullMatch) {
    return fullMatch[0];
  }

  const simpleMatch = compact.match(/(?:\d+x|x\d+)/);
  return simpleMatch ? simpleMatch[0] : "";
}

function flagBadge(flag: "ok" | "warning" | "critical"): { text: string; className: string } {
  if (flag === "critical") {
    return {
      text: "Critical",
      className:
        "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
    };
  }

  if (flag === "warning") {
    return {
      text: "Warning",
      className:
        "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    };
  }

  return {
    text: "OK",
    className:
      "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  };
}

export default function ValidasiResepPage() {
  const [nomorRM, setNomorRM] = useState("");
  const [nomorPeresepan, setNomorPeresepan] = useState("");
  const [nomorObat, setNomorObat] = useState("");
  const [medicineName, setMedicineName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [allergies, setAllergies] = useState("");
  const [diagnosisSummary, setDiagnosisSummary] = useState("");
  const [activeMedicines, setActiveMedicines] = useState("");
  const [companionMedicines, setCompanionMedicines] = useState("");
  const [lookupPrescription, setLookupPrescription] = useState<PrescriptionLookup | null>(null);
  const [selectedLookupNomorObat, setSelectedLookupNomorObat] = useState("");

  const [result, setResult] = useState<DemoPrescriptionValidationResult | null>(null);
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  function applyLookupPrescription(prescription: PrescriptionLookup, preferredNomorObat?: string) {
    setLookupPrescription(prescription);
    setNomorRM(prescription.nomorRM);
    setNomorPeresepan(prescription.nomorPeresepan);

    const selectedItem =
      (preferredNomorObat
        ? prescription.items.find((item) => item.nomorObat === preferredNomorObat)
        : undefined) ?? prescription.items[0];

    if (!selectedItem) {
      setSelectedLookupNomorObat("");
      return;
    }

    setSelectedLookupNomorObat(selectedItem.nomorObat);
    setNomorObat(selectedItem.nomorObat);
    setMedicineName(selectedItem.medicineName);
    setDosage(selectedItem.dosage);
    setQuantity(String(selectedItem.quantity));

    const inferredFrequency = inferFrequencyFromDosage(selectedItem.dosage);
    if (inferredFrequency.length > 0) {
      setFrequency(inferredFrequency);
    }
  }

  function handleLookupPrescriptionItemChange(nextNomorObat: string) {
    setSelectedLookupNomorObat(nextNomorObat);

    if (!lookupPrescription) {
      return;
    }

    const selectedItem = lookupPrescription.items.find((item) => item.nomorObat === nextNomorObat);
    if (!selectedItem) {
      return;
    }

    setNomorObat(selectedItem.nomorObat);
    setMedicineName(selectedItem.medicineName);
    setDosage(selectedItem.dosage);
    setQuantity(String(selectedItem.quantity));

    const inferredFrequency = inferFrequencyFromDosage(selectedItem.dosage);
    if (inferredFrequency.length > 0) {
      setFrequency(inferredFrequency);
    }
  }

  async function fetchPrescriptionLookupData(
    normalizedNomorPeresepan: string,
    normalizedNomorRM: string,
  ): Promise<PrescriptionLookup> {
    const searchParams = new URLSearchParams({
      nomorPeresepan: normalizedNomorPeresepan,
      nomorRM: normalizedNomorRM,
    });

    const response = await fetch(`/api/demo/apoteker/dispensing/resep?${searchParams.toString()}`, {
      cache: "no-store",
    });

    const payload = (await response.json()) as PrescriptionLookupResponse;
    if (!response.ok || !payload.prescription) {
      throw new Error(payload.error || "Data resep tidak ditemukan.");
    }

    return payload.prescription;
  }

  async function handleLookupPrescription(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsLookupLoading(true);

    const normalizedNomorRM = nomorRM.trim().toUpperCase();
    const normalizedNomorPeresepan = nomorPeresepan.trim().toUpperCase();

    if (!normalizedNomorRM || !normalizedNomorPeresepan) {
      setErrorMessage("Nomor RM dan nomor resep wajib diisi untuk isi otomatis.");
      setIsLookupLoading(false);
      return;
    }

    try {
      const prescription = await fetchPrescriptionLookupData(
        normalizedNomorPeresepan,
        normalizedNomorRM,
      );

      applyLookupPrescription(prescription);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setErrorMessage(message);
    } finally {
      setIsLookupLoading(false);
    }
  }

  function resetLookupPrescription() {
    setNomorRM("");
    setNomorPeresepan("");
    setLookupPrescription(null);
    setSelectedLookupNomorObat("");
    setErrorMessage("");
  }

  async function handleValidate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/demo/apoteker/validasi-resep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomorRM,
          nomorPeresepan,
          nomorObat,
          medicineName,
          dosage,
          frequency,
          quantity: Number.parseInt(quantity, 10),
          allergies,
          diagnosisSummary,
          activeMedicines,
          companionMedicines,
        }),
      });

      const payload = (await response.json()) as {
        result?: DemoPrescriptionValidationResult;
        error?: string;
      };

      if (!response.ok || !payload.result) {
        throw new Error(payload.error || "Validasi resep gagal diproses.");
      }

      setResult(payload.result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Validasi Resep</h1>
        <p className="text-muted-foreground text-sm">
          Pemeriksaan klinis resep mencakup kelengkapan data, stok obat, dosis, interaksi, alergi, dan kontraindikasi.
        </p>
      </div>

      <Card className="border-sky-200/80 bg-sky-50/40 dark:border-sky-900/70 dark:bg-sky-950/20">
        <CardHeader>
          <CardTitle>Ringkasan Konteks Pasien</CardTitle>
          <CardDescription>
            Isi konteks klinis singkat untuk membantu apoteker menilai resep lebih akurat.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-4">
          <div className="rounded-md border border-border bg-background/80 p-3">
            <p className="text-muted-foreground text-xs">Nomor RM</p>
            <p className="font-medium text-foreground">{nomorRM.trim() || "Belum diisi"}</p>
          </div>
          <div className="rounded-md border border-border bg-background/80 p-3">
            <p className="text-muted-foreground text-xs">Nomor Resep</p>
            <p className="font-medium text-foreground">{nomorPeresepan.trim() || "Belum diisi"}</p>
          </div>
          <div className="rounded-md border border-border bg-background/80 p-3">
            <p className="text-muted-foreground text-xs">Diagnosis Utama</p>
            <p className="font-medium text-foreground">{diagnosisSummary.trim() || "Belum diisi"}</p>
          </div>
          <div className="rounded-md border border-border bg-background/80 p-3">
            <p className="text-muted-foreground text-xs">Obat Aktif Pasien</p>
            <p className="font-medium text-foreground">{activeMedicines.trim() || "Belum diisi"}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-900/70 dark:bg-emerald-950/20">
        <CardHeader>
          <CardTitle>Isi Otomatis Dari Resep Dokter</CardTitle>
          <CardDescription>
            Masukkan nomor RM dan nomor resep untuk menarik data pasien dan item obat otomatis.
            Semua field tetap bisa disunting manual setelah data terisi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleLookupPrescription}>
            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="lookupNomorRM">
                Nomor RM
              </label>
              <Input
                id="lookupNomorRM"
                value={nomorRM}
                onChange={(event) => setNomorRM(event.target.value.toUpperCase())}
                placeholder="Contoh: RM000001"
                maxLength={32}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="lookupNomorPeresepan">
                Nomor Resep
              </label>
              <Input
                id="lookupNomorPeresepan"
                value={nomorPeresepan}
                onChange={(event) => setNomorPeresepan(event.target.value.toUpperCase())}
                placeholder="Contoh: RSP-20260411-00001"
                maxLength={40}
              />
            </div>

            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={isLookupLoading || isSubmitting}>
                {isLookupLoading ? "Mencari Resep..." : "Isi Otomatis Dari Resep"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={resetLookupPrescription}
                disabled={isLookupLoading || isSubmitting}
              >
                Reset Lookup
              </Button>
            </div>
          </form>

          {lookupPrescription ? (
            <div className="space-y-3 rounded-md border border-border bg-background/80 p-3 text-sm">
              <div className="grid gap-2 md:grid-cols-4">
                <div>
                  <p className="text-muted-foreground text-xs">Nomor RM</p>
                  <p className="font-medium text-foreground">{lookupPrescription.nomorRM}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Nomor Resep</p>
                  <p className="font-medium text-foreground">{lookupPrescription.nomorPeresepan}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Pasien</p>
                  <p className="font-medium text-foreground">{lookupPrescription.patientName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Dokter</p>
                  <p className="font-medium text-foreground">{lookupPrescription.doctorName}</p>
                </div>
              </div>

              {lookupPrescription.items.length > 1 ? (
                <div className="space-y-1">
                  <label className="font-medium text-sm" htmlFor="lookupNomorObat">
                    Pilih Item Obat Resep
                  </label>
                  <select
                    id="lookupNomorObat"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={selectedLookupNomorObat}
                    onChange={(event) => handleLookupPrescriptionItemChange(event.target.value)}
                    disabled={isLookupLoading || isSubmitting}
                  >
                    {lookupPrescription.items.map((item) => (
                      <option key={`${item.nomorObat}-${item.medicineName}`} value={item.nomorObat}>
                        {item.nomorObat} - {item.medicineName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Form Validasi Resep</CardTitle>
          <CardDescription>
            Input resep pasien untuk mendapatkan hasil validasi otomatis berbasis aturan demo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleValidate}>
            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="nomorRM">
                Nomor RM Pasien (Opsional)
              </label>
              <Input
                id="nomorRM"
                value={nomorRM}
                onChange={(event) => setNomorRM(event.target.value.toUpperCase())}
                placeholder="Contoh: RM-0001"
                maxLength={32}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="nomorPeresepan">
                Nomor Resep (Referensi)
              </label>
              <Input
                id="nomorPeresepan"
                value={nomorPeresepan}
                onChange={(event) => setNomorPeresepan(event.target.value.toUpperCase())}
                placeholder="Contoh: RSP-20260411-00001"
                maxLength={40}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="nomorObat">
                Nomor Obat (Opsional)
              </label>
              <Input
                id="nomorObat"
                value={nomorObat}
                onChange={(event) => setNomorObat(event.target.value.toUpperCase())}
                placeholder="Contoh: OBT-0001"
                maxLength={32}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="medicineName">
                Nama Obat
              </label>
              <Input
                id="medicineName"
                value={medicineName}
                onChange={(event) => setMedicineName(event.target.value)}
                placeholder="Contoh: Amoxicillin 500mg"
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="dosage">
                Dosis
              </label>
              <Input
                id="dosage"
                value={dosage}
                onChange={(event) => setDosage(event.target.value)}
                placeholder="Contoh: 500mg"
                maxLength={120}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="frequency">
                Frekuensi
              </label>
              <Input
                id="frequency"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
                placeholder="Contoh: 3x1"
                maxLength={80}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-sm" htmlFor="quantity">
                Jumlah Diminta
              </label>
              <Input
                id="quantity"
                type="number"
                min={1}
                max={500}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="font-medium text-sm" htmlFor="diagnosisSummary">
                Riwayat Penyakit Utama
              </label>
              <textarea
                id="diagnosisSummary"
                className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={diagnosisSummary}
                onChange={(event) => setDiagnosisSummary(event.target.value)}
                placeholder="Contoh: Gagal ginjal kronis, hipertensi"
                maxLength={400}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="font-medium text-sm" htmlFor="activeMedicines">
                Obat Aktif Saat Ini
              </label>
              <textarea
                id="activeMedicines"
                className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={activeMedicines}
                onChange={(event) => setActiveMedicines(event.target.value)}
                placeholder="Contoh: Warfarin, Metformin"
                maxLength={400}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="font-medium text-sm" htmlFor="allergies">
                Riwayat Alergi
              </label>
              <textarea
                id="allergies"
                className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={allergies}
                onChange={(event) => setAllergies(event.target.value)}
                placeholder="Contoh: penicillin"
                maxLength={300}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="font-medium text-sm" htmlFor="companionMedicines">
                Obat Pendamping
              </label>
              <textarea
                id="companionMedicines"
                className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={companionMedicines}
                onChange={(event) => setCompanionMedicines(event.target.value)}
                placeholder="Contoh: warfarin"
                maxLength={300}
              />
            </div>

            <div className="md:col-span-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Memvalidasi..." : "Validasi Resep"}
              </Button>
            </div>
          </form>

          {errorMessage ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-sm dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {errorMessage}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Hasil Validasi</CardTitle>
            <CardDescription>
              Diperiksa pada {new Date(result.checkedAt).toLocaleString("id-ID")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.checks.map((item) => {
              const badge = flagBadge(item.flag);
              return (
                <div key={item.name} className="rounded-md border border-border bg-muted/35 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground text-sm">{item.name}</p>
                    <Badge className={badge.className}>{badge.text}</Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">{item.message}</p>
                </div>
              );
            })}

            <div className="rounded-md border border-border bg-card p-3">
              <p className="font-medium text-foreground text-sm">Rekomendasi</p>
              <p className="text-muted-foreground text-sm">{result.recommendation}</p>
              <p className="mt-1 text-muted-foreground text-xs">
                Status akhir: {result.canProceed ? "Bisa dilanjutkan" : "Tunda proses dispensing"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
