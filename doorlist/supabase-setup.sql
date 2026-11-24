create table if not exists public.doorlist_guests (
  code text primary key check (char_length(code) between 1 and 40),
  name text not null,
  email text not null default '',
  ticket text not null default 'General',
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.doorlist_guests
  add column if not exists checked_out_at timestamptz;

create table if not exists public.doorlist_event (
  id integer primary key check (id = 1),
  name text not null
);

alter table public.doorlist_guests enable row level security;
alter table public.doorlist_event enable row level security;

grant select, insert, update, delete on public.doorlist_guests to authenticated;
grant select, insert, update, delete on public.doorlist_event to authenticated;

drop policy if exists "Staff can manage doorlist guests" on public.doorlist_guests;
create policy "Staff can manage doorlist guests"
  on public.doorlist_guests for all to authenticated
  using (true) with check (true);

drop policy if exists "Staff can manage doorlist event" on public.doorlist_event;
create policy "Staff can manage doorlist event"
  on public.doorlist_event for all to authenticated
  using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'doorlist_guests'
     ) then
    execute 'alter publication supabase_realtime add table public.doorlist_guests';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'doorlist_event'
     ) then
    execute 'alter publication supabase_realtime add table public.doorlist_event';
  end if;
end $$;

notify pgrst, 'reload schema';
