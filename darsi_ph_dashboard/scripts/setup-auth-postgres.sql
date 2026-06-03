-- Jalankan sebagai superuser postgres:
-- sudo -u postgres psql -d postgres -f darsi_ph_dashboard/scripts/setup-auth-postgres.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'darsilogin') THEN
    CREATE ROLE darsilogin WITH LOGIN PASSWORD 'darsilogin';
  ELSE
    ALTER ROLE darsilogin WITH LOGIN PASSWORD 'darsilogin';
  END IF;
END
$$;

SELECT 'CREATE DATABASE daftar_login OWNER darsilogin'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'daftar_login')\gexec

\connect daftar_login

CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'apoteker', 'pasien')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nomor_rm TEXT UNIQUE
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_lower_idx ON auth_users (LOWER(email));
CREATE INDEX IF NOT EXISTS auth_users_role_idx ON auth_users (role);
