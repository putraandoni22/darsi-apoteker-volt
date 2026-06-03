export const OBAT_KODE_LENGTH = 8;

/**
 * Menghasilkan OBAT_KODE dari id master_obat.
 * Contoh: 6199 -> "00006199", 1 -> "00000001".
 */
export function generateObatKodeFromId(id: number): string {
  if (!Number.isInteger(id) || id < 0) {
    throw new RangeError("id harus bilangan bulat >= 0.");
  }

  const idText = String(id);
  if (idText.length > OBAT_KODE_LENGTH) {
    throw new RangeError(`id tidak boleh lebih dari ${OBAT_KODE_LENGTH} digit.`);
  }

  return idText.padStart(OBAT_KODE_LENGTH, "0");
}