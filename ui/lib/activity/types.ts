import type { UserRole } from "@/lib/auth/store";

export type ActivityLevel = "INFO" | "WARN" | "ERROR";

export type ActivityActorRole = UserRole | "guest" | "system";

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  level: ActivityLevel;
  module: string;
  action: string;
  actorId: string;
  actorName: string;
  actorRole: ActivityActorRole;
  detail: string;
  ip: string;
  userAgent: string;
}
