"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface RoleSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDemo?: boolean;
}

const roles = [
  { 
    id: "customer-service",
    label: "Customer Service",
    description: "Koordinasi Pasien",
    demoUrl: "https://darsi.cs.hcm-lab.id/login",
    loginUrl: "https://darsi.cs.hcm-lab.id/login",
  },
  {
    id: "doctor",
    label: "Doctor",
    description: "Dukungan Klinik",
    demoUrl: "https://darsidoc.hcm-lab.id/login",
    loginUrl: "https://darsidoc.hcm-lab.id/login",
  },
  {
    id: "nurse",
    label: "Nurse",
    description: "Pendamping Perawatan",
    demoUrl: "https://darsi.nrs.hcm-lab.id/login", // Placeholder - akan ditambahkan nanti
    loginUrl: "https://darsi.nrs.hcm-lab.id/login", // Placeholder - akan ditambahkan nanti
  },
  {
    id: "pharmacy",
    label: "Pharmacy",
    description: "Operasional Farmasi",
    demoUrl: "https://darsi.ph.hcm-lab.id/signin",
    loginUrl: "https://darsi.ph.hcm-lab.id/signin",
  },
];

export function RoleSelectorModal({ open, onOpenChange, isDemo = false }: RoleSelectorModalProps) {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleCoba = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;

    const url = isDemo ? role.demoUrl : role.loginUrl;

    if (!url) {
      alert("Fitur untuk role ini belum tersedia. Mohon tunggu.");
      return;
    }

    setIsLoading(true);

    // Jika URL eksternal, gunakan window.location.href
    if (url.startsWith("http://") || url.startsWith("https://")) {
      window.location.href = url;
    } else {
      // Jika rute internal, gunakan router.push
      router.push(url);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Coba Darsi Sebagai</DialogTitle>
          <DialogDescription>
            Pilih role untuk mengakses dashboard dan melihat fitur yang tersedia
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {roles.map((role) => {
            const isDisabled = isLoading || (!role.demoUrl && !role.loginUrl);
            const url = isDemo ? role.demoUrl : role.loginUrl;

            return (
              <button
                key={role.id}
                onClick={() => handleCoba(role.id)}
                disabled={isDisabled}
                title={!url ? "Fitur belum tersedia" : ""}
                className="group rounded-lg border-2 border-emerald-200 bg-white p-4 text-left transition-all hover:border-emerald-500 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-[#0a1611] dark:hover:border-emerald-700 dark:hover:bg-[#102019] dark:disabled:border-gray-700 dark:disabled:bg-gray-900"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-emerald-900 dark:text-emerald-100">{role.label}</p>
                    <p className="text-sm text-emerald-700/70 dark:text-emerald-300/70">
                      {role.description}
                      {!url && <span className="ml-2 text-gray-500"> (Coming Soon)</span>}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-emerald-600 transition-transform group-hover:translate-x-1 disabled:text-gray-400 dark:text-emerald-400" />
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
