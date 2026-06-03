import { AdminSystemControlPanel } from "@/components/admin/system-control-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function readEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function maskToken(value: string): string {
  if (!value || value === "(belum diatur)") {
    return value;
  }

  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export default function AdminSystemSettingsPage() {
  const runtimePort = readEnv("PORT", "3000");
  const rateLimitWindow = readEnv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "60");
  const rateLimitMax = readEnv("AUTH_RATE_LIMIT_MAX_ATTEMPTS", "12");
  const demoDbUrl = readEnv("DEMO_LIBSQL_DATABASE_URL", "(belum diatur)");
  const llmEndpoint = readEnv("OLLAMA_BASE_URL", "(belum diatur)");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Pengaturan Sistem</h1>
        <p className="text-muted-foreground text-sm">
          Kontrol infrastruktur lokal: backup, restore, dan konfigurasi parameter server.
        </p>
      </div>

      <AdminSystemControlPanel />

      <Card>
        <CardHeader>
          <CardTitle>Konfigurasi Variabel Lingkungan</CardTitle>
          <CardDescription>
            Parameter runtime yang mempengaruhi performa dan keamanan server lokal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-2">Parameter</th>
                  <th className="px-3 py-2">Nilai Aktif</th>
                  <th className="px-3 py-2">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-3 py-2 font-medium">PORT</td>
                  <td className="px-3 py-2">{runtimePort}</td>
                  <td className="px-3 py-2 text-muted-foreground">Port aplikasi UI berjalan.</td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 font-medium">AUTH_RATE_LIMIT_WINDOW_SECONDS</td>
                  <td className="px-3 py-2">{rateLimitWindow}</td>
                  <td className="px-3 py-2 text-muted-foreground">Jendela waktu rate limit autentikasi.</td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 font-medium">AUTH_RATE_LIMIT_MAX_ATTEMPTS</td>
                  <td className="px-3 py-2">{rateLimitMax}</td>
                  <td className="px-3 py-2 text-muted-foreground">Batas percobaan login dalam satu jendela.</td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 font-medium">DEMO_LIBSQL_DATABASE_URL</td>
                  <td className="px-3 py-2">{maskToken(demoDbUrl)}</td>
                  <td className="px-3 py-2 text-muted-foreground">Koneksi database demo farmasi.</td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 font-medium">OLLAMA_BASE_URL</td>
                  <td className="px-3 py-2">{maskToken(llmEndpoint)}</td>
                  <td className="px-3 py-2 text-muted-foreground">Endpoint server LLM lokal.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
