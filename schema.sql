-- Run this in Supabase SQL Editor
-- Creates the app_data table for the WRG Outreach Tracker

create table if not exists app_data (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Allow all operations for authenticated and anonymous users
-- (tighten with Row Level Security later when you add auth)
alter table app_data enable row level security;

create policy "Allow all" on app_data
  for all using (true) with check (true);

-- Insert the initial empty store record
insert into app_data (id, data)
values ('main', '{"initiatives":[],"contacts":{},"companies":{}}')
on conflict (id) do nothing;
