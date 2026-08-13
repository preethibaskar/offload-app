-- Safe to re-run: skips objects that already exist.

create table if not exists kv_store (
  user_id uuid references auth.users (id) on delete cascade not null,
  key text not null,
  value text not null,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

alter table kv_store enable row level security;

-- Each user can only ever read/write their own rows. This is what actually
-- keeps one invitee's plans and recurring items private from another —
-- not anything in the frontend code.
drop policy if exists "Users manage their own kv rows" on kv_store;
create policy "Users manage their own kv rows"
  on kv_store
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Logs every time a user overrides the AI's category choice. This is your
-- real-world accuracy signal: a running record of exactly which kinds of
-- dumped text the model gets wrong, straight from people actually using it.
create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null default auth.uid(),
  item_text text not null,
  ai_category text not null,
  corrected_category text not null,
  created_at timestamptz default now()
);

alter table corrections enable row level security;

-- Users can insert their own correction rows (so the app can log them
-- client-side) and read them back to build a personalized sort profile.
drop policy if exists "Users can log their own corrections" on corrections;
create policy "Users can log their own corrections"
  on corrections
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can read their own corrections" on corrections;
create policy "Users can read their own corrections"
  on corrections
  for select
  using (auth.uid() = user_id);
