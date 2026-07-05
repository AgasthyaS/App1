import { supabase } from './supabase';

/**
 * Cloud persistence for a user's garden. The whole persisted slice of app state
 * is stored as one JSON blob per user in the `gardens` table (see the SQL in
 * the setup steps). Simple last-write-wins — fine for a single-user-per-account
 * app, and it means every screen's data follows the user across devices.
 */

const TABLE = 'gardens';

/** Reads the user's saved garden, or null if they've never synced one. */
export async function pullGarden(userId: string): Promise<Record<string, any> | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select('state')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.state as Record<string, any>) ?? null;
}

/** Writes the user's garden (insert or update). */
export async function pushGarden(userId: string, state: Record<string, any>): Promise<void> {
  if (!supabase) return;
  await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, state, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
}
