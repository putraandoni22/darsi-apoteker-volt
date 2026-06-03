"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { RoleSelectorModal } from "./role-selector-modal";

interface RoleSelectorClientProps {
  variant?: "header" | "cta";
}

export function RoleSelectorClient({ variant = "header" }: RoleSelectorClientProps) {
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  if (variant === "header") {
    return (
      <>
        <Button
          onClick={() => setDemoModalOpen(true)}
          variant="outline"
          className="h-10 rounded-full border-emerald-300 bg-white px-5 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-700 dark:bg-[#0a1510] dark:text-emerald-200 dark:hover:bg-[#102019]"
        >
          Coba Darsi Sebagai
        </Button>
        <Button
          onClick={() => setLoginModalOpen(true)}
          className="h-10 rounded-full bg-gradient-to-r from-emerald-600 to-green-700 px-5 text-white shadow-[0_16px_28px_-16px_rgba(22,163,74,0.85)] hover:from-emerald-500 hover:to-green-600"
        >
          Masuk Sebagai
          <ArrowRight className="size-4" />
        </Button>
        <RoleSelectorModal open={demoModalOpen} onOpenChange={setDemoModalOpen} isDemo={true} />
        <RoleSelectorModal open={loginModalOpen} onOpenChange={setLoginModalOpen} isDemo={false} />
      </>
    );
  }

  return (
    <>
      <Button
        onClick={() => setDemoModalOpen(true)}
        size="lg"
        variant="outline"
        className="h-12 rounded-full border-emerald-300 bg-white px-7 text-base text-emerald-900 hover:bg-emerald-50 dark:border-emerald-700 dark:bg-[#0a1510] dark:text-emerald-200 dark:hover:bg-[#11231b]"
      >
        Daftar
      </Button>
      <Button
        onClick={() => setLoginModalOpen(true)}
        size="lg"
        className="h-12 rounded-full bg-gradient-to-r from-emerald-500 to-green-600 px-7 text-base text-white shadow-[0_18px_30px_-18px_rgba(22,163,74,0.65)] hover:from-emerald-400 hover:to-green-500"
      >
        Sign-in
        <ArrowRight className="size-4" />
      </Button>
      <RoleSelectorModal open={demoModalOpen} onOpenChange={setDemoModalOpen} isDemo={true} />
      <RoleSelectorModal open={loginModalOpen} onOpenChange={setLoginModalOpen} isDemo={false} />
    </>
  );
}
