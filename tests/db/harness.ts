import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

/**
 * A real Postgres (PGlite — Postgres compiled to WASM) with just enough of
 * Supabase around it to run the project's SQL exactly as written: the `auth`
 * schema, `auth.uid()`, and the three API roles with Supabase's default grants.
 *
 * What this does NOT reproduce: PostgREST, the storage service, pg_cron, and
 * Supabase's own auth triggers. Policies and functions are exercised by
 * switching role and JWT subject, which is what PostgREST does per request.
 */

const ROOT = path.resolve(__dirname, '../..');

/** Install order — the same list as docs/DATABASE.md. */
export const SQL_FILES = [
  'supabase-setup.sql',
  'supabase-fix-uploads.sql',
  'supabase-hybrid-sync.sql',
  'supabase-device-manager.sql',
  'supabase-device-transfer.sql',
  'supabase-firmware.sql',
  'supabase-sharing.sql',
  'supabase/schema.sql',
  'supabase-moat.sql',
  'supabase-delete-user.sql',
  'supabase-analytics.sql',
  'supabase/migrations/20261112000000_platform.sql',
  'supabase/seed/substrates.sql',
];

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export interface Db {
  pg: PGlite;
  /** run as the database owner (what the SQL editor does) */
  sql: <T = any>(q: string, params?: unknown[]) => Promise<T[]>;
  /** run as a signed-in user, through RLS */
  as: <T = any>(userId: string | null, q: string, params?: unknown[]) => Promise<T[]>;
  newUser: (email: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function createDb(files: string[] = SQL_FILES): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(BOOTSTRAP);
  for (const f of files) {
    try {
      await pg.exec(readFileSync(path.join(ROOT, f), 'utf8'));
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
  const sql = async <T,>(q: string, params: unknown[] = []) => (await pg.query<T>(q, params as any[])).rows;
  const as = async <T,>(userId: string | null, q: string, params: unknown[] = []) =>
    pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
      return (await tx.query<T>(q, params as any[])).rows;
    });
  const newUser = async (email: string) =>
    (await sql<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]))[0].id;
  return { pg, sql, as, newUser, close: () => pg.close() };
}

/** Rerun every file on an existing database — the "safe to re-run" claim, tested. */
export async function rerunAll(db: Db, files: string[] = SQL_FILES): Promise<void> {
  for (const f of files) {
    try {
      await db.pg.exec(readFileSync(path.join(ROOT, f), 'utf8'));
    } catch (e) {
      throw new Error(`re-run ${f}: ${(e as Error).message}`);
    }
  }
}
