-- =============================================
-- Run this in Supabase Dashboard > SQL Editor
-- =============================================

-- 1. Profiles table (extends auth.users with role)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamp with time zone default now()
);

-- 2. Productivity data (parsed from TEAM_PRODUCTIVITY Excel)
create table public.productivity_records (
  id uuid default gen_random_uuid() primary key,
  data jsonb not null,
  dates jsonb not null,
  members jsonb not null,
  uploaded_by uuid references auth.users,
  uploaded_at timestamp with time zone default now()
);

-- 3. Attendance data (parsed from ATT_Month Excel)
create table public.attendance_records (
  id uuid default gen_random_uuid() primary key,
  month_key text not null unique,
  month_label text not null,
  data jsonb not null,
  uploaded_by uuid references auth.users,
  uploaded_at timestamp with time zone default now()
);

-- 4. Enable Row Level Security
alter table public.profiles enable row level security;
alter table public.productivity_records enable row level security;
alter table public.attendance_records enable row level security;

-- 5. Helper: check if current user is admin
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer;

-- 6. RLS Policies

-- Profiles: anyone logged in can read, only admins can modify
create policy "Anyone can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Admins can insert profiles"
  on public.profiles for insert
  to authenticated
  with check (public.is_admin() or not exists (select 1 from public.profiles));

create policy "Admins can update profiles"
  on public.profiles for update
  to authenticated
  using (public.is_admin());

create policy "Admins can delete profiles"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- Productivity: anyone reads, admins write
create policy "Anyone can read productivity"
  on public.productivity_records for select
  to authenticated
  using (true);

create policy "Admins can insert productivity"
  on public.productivity_records for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update productivity"
  on public.productivity_records for update
  to authenticated
  using (public.is_admin());

create policy "Admins can delete productivity"
  on public.productivity_records for delete
  to authenticated
  using (public.is_admin());

-- Attendance: anyone reads, admins write
create policy "Anyone can read attendance"
  on public.attendance_records for select
  to authenticated
  using (true);

create policy "Admins can insert attendance"
  on public.attendance_records for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can upsert attendance"
  on public.attendance_records for update
  to authenticated
  using (public.is_admin());

create policy "Admins can delete attendance"
  on public.attendance_records for delete
  to authenticated
  using (public.is_admin());

-- 7. Auto-create profile on first sign-up (trigger)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when not exists (select 1 from public.profiles) then 'admin' else 'viewer' end
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
