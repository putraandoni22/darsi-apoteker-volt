-- Menambahkan relasi Agnostic ID untuk catatan_asuhan_apoteker.
-- Kolom baru: obat_id (Foreign Key ke master_obat.id).
-- Payload integrasi eksternal dapat memetakan obat_id -> OBAT_KODE (8 digit) pada layer API.

BEGIN;

ALTER TABLE catatan_asuhan_apoteker
  RENAME TO catatan_asuhan_apoteker_legacy_20260410;

CREATE TABLE catatan_asuhan_apoteker (
  id TEXT PRIMARY KEY,
  nomor_rm TEXT NOT NULL,
  obat_id INTEGER,
  catatan TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (obat_id) REFERENCES master_obat(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

INSERT INTO catatan_asuhan_apoteker (id, nomor_rm, obat_id, catatan, created_at, updated_at)
SELECT
  COALESCE(NULLIF(TRIM(CAST(id AS TEXT)), ''), lower(hex(randomblob(16)))) AS id,
  COALESCE(NULLIF(TRIM(CAST(nomor_rm AS TEXT)), ''), 'RM-UNKNOWN') AS nomor_rm,
  NULL AS obat_id,
  COALESCE(CAST(catatan AS TEXT), '') AS catatan,
  COALESCE(NULLIF(TRIM(CAST(created_at AS TEXT)), ''), datetime('now')) AS created_at,
  COALESCE(NULLIF(TRIM(CAST(updated_at AS TEXT)), ''), datetime('now')) AS updated_at
FROM catatan_asuhan_apoteker_legacy_20260410;

CREATE INDEX IF NOT EXISTS idx_catatan_asuhan_apoteker_nomor_rm
  ON catatan_asuhan_apoteker(nomor_rm);

CREATE INDEX IF NOT EXISTS idx_catatan_asuhan_apoteker_obat_id
  ON catatan_asuhan_apoteker(obat_id);

DROP TABLE catatan_asuhan_apoteker_legacy_20260410;

COMMIT;
