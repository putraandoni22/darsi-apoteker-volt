import type { DemoDispensingWorkflowStatus } from "@/lib/demo/types";

export const DISPENSING_WORKFLOW_STATUSES = [
  "menunggu_validasi_resep",
  "menunggu_pembayaran",
  "siap_diracik",
  "sedang_diracik",
  "siap_diserahkan",
  "diserahkan",
  "cancel",
] as const satisfies readonly DemoDispensingWorkflowStatus[];

export const DISPENSING_WORKFLOW_TRANSITION_STATUSES = [
  "sedang_diracik",
  "siap_diserahkan",
  "diserahkan",
] as const;

export type DispensingWorkflowTransitionStatus =
  (typeof DISPENSING_WORKFLOW_TRANSITION_STATUSES)[number];

export function isDispensingWorkflowStatus(
  value: unknown,
): value is DemoDispensingWorkflowStatus {
  return (
    typeof value === "string" &&
    (DISPENSING_WORKFLOW_STATUSES as readonly string[]).includes(value)
  );
}

export function isDispensingWorkflowTransitionStatus(
  value: unknown,
): value is DispensingWorkflowTransitionStatus {
  return (
    typeof value === "string" &&
    (DISPENSING_WORKFLOW_TRANSITION_STATUSES as readonly string[]).includes(value)
  );
}
