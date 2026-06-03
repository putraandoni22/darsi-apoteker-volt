"use client";

import { useCallback, useEffect, useState } from "react";
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

interface KnowledgeBaseDocument {
  id: string;
  name: string;
  type: string;
  version: string;
  updatedAt: string;
  status: "indexed" | "waiting";
}

interface VectorStatus {
  scheduleEnabled: boolean;
  scheduleTime: string;
  lastIndexedAt: string | null;
  lastIndexedCount: number;
  pendingCount: number;
}

interface KnowledgeBaseApiPayload {
  documents?: KnowledgeBaseDocument[];
  vector?: VectorStatus;
  message?: string;
  error?: string;
}

type KnowledgeBaseAction =
  | "update-document"
  | "delete-document"
  | "reindex-all"
  | "partial-reindex"
  | "schedule-vector-sync"
  | "disable-vector-sync";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusBadgeClass(status: string): string {
  if (status === "indexed") {
    return "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
  }

  return "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
}

function statusLabel(status: string): string {
  return status === "indexed" ? "Terindeks" : "Menunggu Sinkron";
}

export default function AdminKnowledgeBasePage() {
  const [documents, setDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [vector, setVector] = useState<VectorStatus | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/admin/knowledge-base", {
        cache: "no-store",
      });

      const payload = (await response.json()) as KnowledgeBaseApiPayload;
      if (!response.ok) {
        throw new Error(payload.error || "Gagal memuat data knowledge base.");
      }

      setDocuments(payload.documents ?? []);
      setVector(payload.vector ?? null);
      if (payload.documents && payload.documents.length > 0) {
        setSelectedDocumentId((previousId) => {
          const stillExists = payload.documents?.some((item) => item.id === previousId);
          return stillExists ? previousId : payload.documents?.[0]?.id || "";
        });
      } else {
        setSelectedDocumentId("");
      }
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Gagal memuat data knowledge base.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runJsonAction = useCallback(
    async (action: KnowledgeBaseAction, extraBody?: Record<string, unknown>) => {
      setRunningAction(action);
      setFeedback(null);

      try {
        const response = await fetch("/api/admin/knowledge-base", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action, ...(extraBody ?? {}) }),
        });

        const payload = (await response.json()) as KnowledgeBaseApiPayload;
        if (!response.ok) {
          throw new Error(payload.error || "Operasi knowledge base gagal diproses.");
        }

        setDocuments(payload.documents ?? []);
        setVector(payload.vector ?? null);
        setFeedback({
          type: "success",
          text: payload.message || "Operasi knowledge base berhasil.",
        });
      } catch (error) {
        setFeedback({
          type: "error",
          text: error instanceof Error ? error.message : "Operasi knowledge base gagal.",
        });
      } finally {
        setRunningAction(null);
      }
    },
    [],
  );

  const uploadDocument = useCallback(async () => {
    if (!selectedFile) {
      setFeedback({ type: "error", text: "Pilih file dokumen terlebih dahulu." });
      return;
    }

    setRunningAction("upload-document");
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.set("action", "upload-document");
      formData.set("file", selectedFile);

      const response = await fetch("/api/admin/knowledge-base", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as KnowledgeBaseApiPayload;
      if (!response.ok) {
        throw new Error(payload.error || "Upload dokumen gagal diproses.");
      }

      setDocuments(payload.documents ?? []);
      setVector(payload.vector ?? null);
      setSelectedFile(null);
      setFeedback({
        type: "success",
        text: payload.message || "Dokumen knowledge base berhasil diunggah.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Upload dokumen gagal diproses.",
      });
    } finally {
      setRunningAction(null);
    }
  }, [selectedFile]);

  const selectedDocuments = selectedDocumentId ? [selectedDocumentId] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Manajemen Knowledge Base AI</h1>
        <p className="text-muted-foreground text-sm">
          Kelola dokumen sumber dan proses indexing vector database agar respons AI tetap relevan.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manajemen Dokumen / Vektor</CardTitle>
          <CardDescription>
            Upload, perbarui, atau hapus dokumen basis pengetahuan tanpa menyentuh kode.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
            <Input
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
              }}
            />
            <Button
              className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
              disabled={runningAction !== null || !selectedFile}
              onClick={() => void uploadDocument()}
            >
              Upload Dokumen Baru
            </Button>
            <Button
              variant="outline"
              disabled={runningAction !== null || !selectedDocumentId}
              onClick={() =>
                void runJsonAction("update-document", {
                  documentId: selectedDocumentId,
                })
              }
            >
              Perbarui Dokumen
            </Button>
            <Button
              variant="outline"
              disabled={runningAction !== null || !selectedDocumentId}
              onClick={() =>
                void runJsonAction("delete-document", {
                  documentId: selectedDocumentId,
                })
              }
            >
              Hapus Dokumen
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2">Pilih</th>
                  <th className="px-3 py-2">Nama Dokumen</th>
                  <th className="px-3 py-2">Tipe</th>
                  <th className="px-3 py-2">Versi</th>
                  <th className="px-3 py-2">Update Terakhir</th>
                  <th className="px-3 py-2">Status Vektor</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr className="border-t">
                    <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                      Memuat knowledge base...
                    </td>
                  </tr>
                ) : documents.length === 0 ? (
                  <tr className="border-t">
                    <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                      Belum ada dokumen knowledge base.
                    </td>
                  </tr>
                ) : (
                  documents.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          type="radio"
                          checked={selectedDocumentId === item.id}
                          onChange={() => setSelectedDocumentId(item.id)}
                        />
                      </td>
                    <td className="px-3 py-2 font-medium">{item.name}</td>
                    <td className="px-3 py-2">{item.type}</td>
                    <td className="px-3 py-2">{item.version}</td>
                    <td className="px-3 py-2">{formatTimestamp(item.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <Badge className={statusBadgeClass(item.status)}>
                        {statusLabel(item.status)}
                      </Badge>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sinkronisasi Data Vektor</CardTitle>
            <CardDescription>
              Jalankan re-index manual ketika data source berubah.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
              {vector
                ? `${vector.pendingCount} dokumen menunggu indexing. Terakhir index ${vector.lastIndexedAt ? formatTimestamp(vector.lastIndexedAt) : "belum pernah"}.`
                : "Status vektor belum tersedia."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-400 hover:to-green-500"
                disabled={runningAction !== null}
                onClick={() => void runJsonAction("reindex-all")}
              >
                Re-index Sekarang
              </Button>
              <Button
                variant="outline"
                disabled={runningAction !== null || !selectedDocumentId}
                onClick={() =>
                  void runJsonAction("partial-reindex", {
                    documentIds: selectedDocuments,
                  })
                }
              >
                Sinkronisasi Parsial
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Penjadwalan Otomatis</CardTitle>
            <CardDescription>
              Atur sinkronisasi rutin agar knowledge base selalu terbaru.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Jadwal aktif: {vector?.scheduleEnabled ? `${vector.scheduleTime} WIB` : "nonaktif"}.
            </p>
            <p>Mode fallback: jalankan otomatis saat ada perubahan file sumber.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={runningAction !== null}
                onClick={() => void runJsonAction("schedule-vector-sync")}
              >
                Ubah Jadwal
              </Button>
              <Button
                variant="outline"
                disabled={runningAction !== null}
                onClick={() => void runJsonAction("disable-vector-sync")}
              >
                Nonaktifkan Auto Sync
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {feedback ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
              : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100"
          }`}
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  );
}
