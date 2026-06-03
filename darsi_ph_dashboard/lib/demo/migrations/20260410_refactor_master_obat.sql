-- Refactor tabel master_obat menjadi referensi klinis non-transaksional.
-- Kolom target: id, nama_obat, kategori.

BEGIN;

ALTER TABLE master_obat RENAME TO master_obat_legacy_20260410;

CREATE TABLE master_obat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_obat VARCHAR(255) NOT NULL,
  kategori VARCHAR(120) NOT NULL DEFAULT 'umum'
);

INSERT INTO master_obat (id, nama_obat, kategori)
SELECT
  CAST(OBAT_ID AS INTEGER) AS id,
  COALESCE(
    NULLIF(TRIM(OBAT_NAMA), ''),
    NULLIF(TRIM(OBAT_NAMA_GENERIK), ''),
    'NAMA_TIDAK_DIKETAHUI'
  ) AS nama_obat,
  'umum' AS kategori
FROM master_obat_legacy_20260410;

DROP TABLE master_obat_legacy_20260410;

COMMIT;
