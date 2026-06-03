import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  ClipboardCheck,
  CreditCard,
  FlaskConical,
  HeartPulse,
  Home,
  PackageSearch,
  Pill,
  Users,
} from "lucide-react";
import type { UserRole } from "@/lib/auth/store";

export interface DashboardNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

const NAVIGATION_BY_ROLE: Record<UserRole, DashboardNavItem[]> = {
  admin: [
    { title: "Overview", href: "/admin", icon: Home },
    {
      title: "Manajemen Obat",
      href: "/admin/monitoring-obat",
      icon: PackageSearch,
    },
    {
      title: "Daftar Transaksi Obat",
      href: "/admin/transaksi-obat",
      icon: ArrowLeftRight,
    },
    { title: "Manajemen User", href: "/admin/users", icon: Users },
    {
      title: "Log Aktivitas & Error",
      href: "/admin/logs",
      icon: ClipboardCheck,
    },
  ],
  apoteker: [
    { title: "Overview", href: "/apoteker", icon: Home },
    {
      title: "Asisten Obat",
      href: "/apoteker/asisten-obat",
      icon: HeartPulse,
    },
    { title: "Dispensing", href: "/apoteker/dispensing", icon: FlaskConical },
    {
      title: "Validasi Resep",
      href: "/apoteker/validasi-resep",
      icon: ClipboardCheck,
    },
    {
      title: "Monitoring Stok",
      href: "/apoteker/monitoring-stok",
      icon: PackageSearch,
    },
    {
      title: "Daftar Transaksi Obat",
      href: "/apoteker/transaksi-obat",
      icon: ArrowLeftRight,
    },
  ],
  pasien: [
    { title: "Dashboard", href: "/pasien", icon: Home },
    {
      title: "Asisten Obat",
      href: "/pasien/asisten-obat",
      icon: HeartPulse,
    },
    {
      title: "Pusat Informasi Obat",
      href: "/pasien/informasi-obat",
      icon: Pill,
    },
    {
      title: "Pembayaran & Konfirmasi Resep",
      href: "/pasien/pembayaran",
      icon: CreditCard,
    },
    {
      title: "Pelacakan Status Peracikan",
      href: "/pasien/pelacakan-status",
      icon: ClipboardCheck,
    },
    {
      title: "Riwayat Transaksi & Medikasi",
      href: "/pasien/riwayat-transaksi",
      icon: ArrowLeftRight,
    },
  ],
};

export function getNavigationByRole(role: UserRole): DashboardNavItem[] {
  return NAVIGATION_BY_ROLE[role] ?? NAVIGATION_BY_ROLE.pasien;
}
