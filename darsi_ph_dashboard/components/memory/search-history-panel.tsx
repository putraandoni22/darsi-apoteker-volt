"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  History,
  Database,
  Clock,
  Search,
  TrendingUp,
  RefreshCw,
} from "lucide-react";

interface ConversationMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface MemoryStats {
  status: string;
  type: string;
  timestamp: string;
}

export function SearchHistoryPanel() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/memory/stats");
      if (!response.ok) throw new Error("Failed to fetch stats");

      const data = await response.json();
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      console.error("Error fetching stats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Riwayat Pencarian
            </CardTitle>
            <CardDescription>
              Riwayat pencarian obat disimpan otomatis
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchStats}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Memory Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
            <Database className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Storage
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {isLoading ? (
                  <Skeleton className="h-4 w-24 mt-1" />
                ) : stats ? (
                  stats.type
                ) : (
                  "Tidak tersedia"
                )}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
            <Clock className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Status
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {isLoading ? (
                  <Skeleton className="h-4 w-24 mt-1" />
                ) : stats ? (
                  <Badge variant="outline" className="capitalize">
                    {stats.status}
                  </Badge>
                ) : (
                  "Tidak tersedia"
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Fitur Memory System:
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-sm">
              <Search className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">
                Simpan semua pencarian obat otomatis
              </span>
            </li>
            <li className="flex items-start gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">
                Analytics obat yang paling sering dicari
              </span>
            </li>
            <li className="flex items-start gap-2 text-sm">
              <History className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">
                Personalisasi berdasarkan riwayat user
              </span>
            </li>
          </ul>
        </div>

        {/* Last Updated */}
        {stats && (
          <div className="pt-4 border-t dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Last updated:{" "}
              {new Date(stats.timestamp).toLocaleTimeString("id-ID")}
            </p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
