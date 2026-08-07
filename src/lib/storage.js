import { supabase } from "../supabaseClient";

// Drop-in replacement for the artifact-only `window.storage` API, backed by
// a single `kv_store` table in Supabase (see supabase/schema.sql). Every row
// is scoped to the signed-in user via Row Level Security, so this file never
// has to think about "whose data is this" — Supabase enforces it server-side.
//
// Signature intentionally mirrors window.storage: get/set/delete/list.
// The `shared` flag from the original API is not implemented (this app has
// no shared data), and is ignored if passed.

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    throw new Error("Not signed in");
  }
  return data.user.id;
}

export const storage = {
  async get(key) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("kv_store")
      .select("value")
      .eq("user_id", userId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: data.value };
  },

  async set(key, value) {
    const userId = await currentUserId();
    const { error } = await supabase
      .from("kv_store")
      .upsert(
        { user_id: userId, key, value, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" }
      );
    if (error) throw error;
    return { key, value };
  },

  async delete(key) {
    const userId = await currentUserId();
    const { error } = await supabase
      .from("kv_store")
      .delete()
      .eq("user_id", userId)
      .eq("key", key);
    if (error) throw error;
    return { key, deleted: true };
  },

  async list(prefix = "") {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("kv_store")
      .select("key")
      .eq("user_id", userId)
      .ilike("key", `${prefix}%`);
    if (error) throw error;
    return { keys: (data || []).map((row) => row.key), prefix };
  },
};
