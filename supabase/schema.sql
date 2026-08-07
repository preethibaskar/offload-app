-- Run this once in the Supabase SQL editor for your project.

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
create policy "Users manage their own kv rows"
  on kv_store
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
