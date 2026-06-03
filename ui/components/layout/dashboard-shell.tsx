"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserRound } from "lucide-react";
import { DarsiLogo } from "@/components/branding/darsi-logo";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import type { PublicUser } from "@/lib/auth/store";
import { getNavigationByRole } from "@/lib/navigation-config";

interface DashboardShellProps {
  user: PublicUser;
  children: React.ReactNode;
}

function toHeadingFromPath(pathname: string): string {
  const chunks = pathname.split("/").filter(Boolean);
  if (chunks.length === 0) {
    return "Dashboard";
  }

  if (
    chunks.length === 1 &&
    (chunks[0] === "admin" || chunks[0] === "apoteker" || chunks[0] === "pasien")
  ) {
    return "Overview";
  }

  const lastChunk = chunks[chunks.length - 1] ?? "dashboard";
  return lastChunk
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toWorkspaceLabel(role: PublicUser["role"]): string {
  if (role === "admin") {
    return "Workspace Admin";
  }

  if (role === "apoteker") {
    return "Workspace Apoteker";
  }

  return "Workspace Pasien";
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const pathname = usePathname();
  const navItems = getNavigationByRole(user.role);
  const heading = toHeadingFromPath(pathname);
  const workspaceLabel = toWorkspaceLabel(user.role);
  const profileCaption = user.email?.trim() || user.name;

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "250px",
          "--sidebar-width-icon": "84px",
        } as React.CSSProperties
      }
    >
      <div className="h-dvh w-screen overflow-hidden bg-emerald-50 p-2 text-foreground md:p-3">
        <div className="flex h-full min-h-0 w-full gap-2 md:gap-3">
        <Sidebar variant="floating" collapsible="icon">
          <SidebarHeader className="border-slate-200 border-b px-4 py-5 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-4">
            <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
              <DarsiLogo
                size={40}
                withText={false}
                className="gap-0"
                imageClassName="rounded-xl"
              />
              <div className="group-data-[collapsible=icon]:hidden">
                <p className="text-sm font-bold tracking-[0.04em] text-slate-800 uppercase">
                  DARSI
                </p>
                <p className="text-[11px] tracking-[0.1em] text-emerald-600 uppercase">
                  Digital Assistant for RSI Surabaya
                </p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="px-4 pt-4 pb-2 text-[11px] font-semibold tracking-[0.1em] text-slate-500 uppercase">
                Menu {user.role}
              </SidebarGroupLabel>
              <SidebarGroupContent className="px-3 py-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-4">
                <SidebarMenu className="space-y-1">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive =
                      pathname === item.href ||
                      (item.href !== "/" && pathname.startsWith(`${item.href}/`));

                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          className="h-auto rounded-lg py-2 text-slate-600 text-sm font-medium transition hover:bg-slate-100 hover:text-slate-900 data-[active=true]:bg-emerald-50 data-[active=true]:text-emerald-700"
                        >
                          <Link href={item.href}>
                            <Icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-slate-200 border-t px-4 py-4 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3">
            <div className="group-data-[collapsible=icon]:hidden">
              <p className="text-xs font-semibold text-slate-700">Profil Saya</p>
              <p className="mt-0.5 truncate text-slate-500 text-xs">
                {profileCaption}
              </p>
            </div>
            <div className="hidden justify-center group-data-[collapsible=icon]:flex">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <UserRound className="h-4 w-4" />
              </div>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="mt-2 justify-start group-data-[collapsible=icon]:hidden"
            >
              <Link href="/profile">Buka Profil</Link>
            </Button>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white">
          <header className="flex h-16 items-center justify-between border-slate-200 border-b bg-white px-4 md:px-5">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="h-8 w-8 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{heading}</p>
                <p className="text-slate-500 text-xs">{workspaceLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LogoutButton />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto rounded-b-2xl bg-slate-50 p-4 md:p-6">
            {children}
          </main>
        </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
