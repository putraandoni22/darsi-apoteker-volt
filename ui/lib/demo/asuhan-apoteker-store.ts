import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  catatanAsuhanApotekerTable,
  getDemoDb,
  masterObatTable,
} from "@/lib/demo/db";
import { generateObatKodeFromId } from "@/lib/demo/master-obat";
import type {
  CreateDemoCatatanAsuhanApotekerInput,
  DemoCatatanAsuhanApoteker,
  ListDemoCatatanAsuhanApotekerOptions,
} from "@/lib/demo/types";

export type CatatanAsuhanApotekerErrorCode =
  | "nomor_rm_required"
  | "obat_id_invalid"
  | "obat_not_found"
  | "catatan_required";

export class CatatanAsuhanApotekerError extends Error {
  readonly code: CatatanAsuhanApotekerErrorCode;

  constructor(message: string, code: CatatanAsuhanApotekerErrorCode) {
    super(message);
    this.name = "CatatanAsuhanApotekerError";
    this.code = code;
  }
}

interface CatatanAsuhanJoinedRow {
  id: string;
  nomorRM: string;
  obatId: number | null;
  catatan: string;
  createdAt: string;
  updatedAt: string;
  namaObat: string | null;
  kategori: string | null;
}

function normalizeNomorRM(raw: string): string {
  return raw.trim().toUpperCase();
}

function mapCatatanRowToDto(row: CatatanAsuhanJoinedRow): DemoCatatanAsuhanApoteker {
  return {
    id: row.id,
    nomorRM: row.nomorRM,
    obatId: row.obatId,
    obatKode: typeof row.obatId === "number" ? generateObatKodeFromId(row.obatId) : null,
    namaObat: row.namaObat,
    kategori: row.kategori,
    catatan: row.catatan,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCatatanAsuhanApoteker(
  options?: ListDemoCatatanAsuhanApotekerOptions,
): Promise<DemoCatatanAsuhanApoteker[]> {
  const db = await getDemoDb();
  const nomorRMFilter = options?.nomorRM ? normalizeNomorRM(options.nomorRM) : "";
  const obatIdFilter =
    typeof options?.obatId === "number" && Number.isInteger(options.obatId) && options.obatId > 0
      ? options.obatId
      : null;

  const filters = [];
  if (nomorRMFilter) {
    filters.push(eq(catatanAsuhanApotekerTable.nomorRM, nomorRMFilter));
  }
  if (obatIdFilter !== null) {
    filters.push(eq(catatanAsuhanApotekerTable.obatId, obatIdFilter));
  }

  const baseQuery = db
    .select({
      id: catatanAsuhanApotekerTable.id,
      nomorRM: catatanAsuhanApotekerTable.nomorRM,
      obatId: catatanAsuhanApotekerTable.obatId,
      catatan: catatanAsuhanApotekerTable.catatan,
      createdAt: catatanAsuhanApotekerTable.createdAt,
      updatedAt: catatanAsuhanApotekerTable.updatedAt,
      namaObat: masterObatTable.namaObat,
      kategori: masterObatTable.kategori,
    })
    .from(catatanAsuhanApotekerTable)
    .leftJoin(masterObatTable, eq(catatanAsuhanApotekerTable.obatId, masterObatTable.id))
    .orderBy(desc(catatanAsuhanApotekerTable.updatedAt));

  const rows: CatatanAsuhanJoinedRow[] =
    filters.length === 0
      ? await baseQuery
      : filters.length === 1
        ? await baseQuery.where(filters[0])
        : await baseQuery.where(and(...filters));

  return rows.map(mapCatatanRowToDto);
}

export async function createCatatanAsuhanApoteker(
  input: CreateDemoCatatanAsuhanApotekerInput,
): Promise<DemoCatatanAsuhanApoteker> {
  const nomorRM = normalizeNomorRM(input.nomorRM);
  if (!nomorRM) {
    throw new CatatanAsuhanApotekerError("Nomor RM wajib diisi.", "nomor_rm_required");
  }

  if (!Number.isInteger(input.obatId) || input.obatId <= 0) {
    throw new CatatanAsuhanApotekerError("obatId tidak valid.", "obat_id_invalid");
  }

  const catatan = input.catatan.trim();
  if (!catatan) {
    throw new CatatanAsuhanApotekerError("Catatan wajib diisi.", "catatan_required");
  }

  const db = await getDemoDb();
  const [masterObat] = await db
    .select({
      id: masterObatTable.id,
      namaObat: masterObatTable.namaObat,
      kategori: masterObatTable.kategori,
    })
    .from(masterObatTable)
    .where(eq(masterObatTable.id, input.obatId))
    .limit(1);

  if (!masterObat) {
    throw new CatatanAsuhanApotekerError(
      `Data master_obat dengan id ${input.obatId} tidak ditemukan.`,
      "obat_not_found",
    );
  }

  const now = new Date().toISOString();
  const id = `caa-${randomUUID().slice(0, 8)}`;

  await db.insert(catatanAsuhanApotekerTable).values({
    id,
    nomorRM,
    obatId: masterObat.id,
    catatan,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    nomorRM,
    obatId: masterObat.id,
    obatKode: generateObatKodeFromId(masterObat.id),
    namaObat: masterObat.namaObat,
    kategori: masterObat.kategori,
    catatan,
    createdAt: now,
    updatedAt: now,
  };
}
