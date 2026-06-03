import { NextResponse, type NextRequest } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { logActivitySafe } from "@/lib/activity/store";
import { createReminder, listRemindersByUser } from "@/lib/demo/store";
import type { DemoReminderChannel } from "@/lib/demo/types";

export const dynamic = "force-dynamic";

function isReminderChannel(value: unknown): value is DemoReminderChannel {
  return (
    value === "aplikasi" ||
    value === "email" ||
    value === "sms" ||
    value === "whatsapp" ||
    value === "telegram"
  );
}

function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isIsoTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function GET(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "pasien") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const reminders = await listRemindersByUser(user.id);
  return NextResponse.json({ reminders });
}

export async function POST(request: NextRequest) {
  const user = await getApiAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "pasien") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body tidak valid." }, { status: 400 });
  }

  const title = (body as { title?: unknown }).title;
  const date = (body as { date?: unknown }).date;
  const time = (body as { time?: unknown }).time;
  const channel = (body as { channel?: unknown }).channel;
  const note = (body as { note?: unknown }).note;

  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  const normalizedDate = typeof date === "string" ? date.trim() : "";
  const normalizedTime = typeof time === "string" ? time.trim() : "";
  const normalizedNote = typeof note === "string" ? note.trim() : "";

  if (normalizedTitle.length < 3 || normalizedTitle.length > 80) {
    return NextResponse.json({ error: "Judul pengingat wajib diisi." }, { status: 400 });
  }

  if (!isIsoDateString(normalizedDate)) {
    return NextResponse.json({ error: "Tanggal pengingat tidak valid." }, { status: 400 });
  }

  if (!isIsoTimeString(normalizedTime)) {
    return NextResponse.json({ error: "Jam pengingat tidak valid." }, { status: 400 });
  }

  if (!isReminderChannel(channel)) {
    return NextResponse.json({ error: "Kanal pengingat tidak valid." }, { status: 400 });
  }

  if (normalizedNote.length > 240) {
    return NextResponse.json({ error: "Catatan terlalu panjang." }, { status: 400 });
  }

  const reminder = await createReminder({
    userId: user.id,
    title: normalizedTitle,
    date: normalizedDate,
    time: normalizedTime,
    channel,
    note: normalizedNote,
  });

  await logActivitySafe({
    module: "PASIEN",
    action: "REMINDER_CREATED",
    detail: `Pengingat "${normalizedTitle}" (${normalizedDate} ${normalizedTime}) berhasil dibuat dengan kanal ${channel}.`,
    user: { id: user.id, name: user.name, role: user.role },
    request,
  });

  return NextResponse.json({ reminder }, { status: 201 });
}
