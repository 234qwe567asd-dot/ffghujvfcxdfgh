-- 文書日課：資料庫與權限規則
-- 用法：Supabase 後台 → SQL Editor → 貼上整份 → Run。可重複執行，不會重複建立。
-- 安全靠這裡的 Row Level Security（列級權限），不是靠隱藏網站裡的金鑰。

-- ============ 1. 個人資料 ============
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text not null default '',
  role         text not null default 'student' check (role in ('student', 'admin')),
  created_at   timestamptz not null default now()
);

-- 是否為管理員。用 security definer 避免權限規則互相遞迴。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- 有人註冊時，自動建立個人資料（預設是選手）。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 補上在建立規則之前就已註冊的帳號
insert into public.profiles (id, email, display_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'display_name', '')
from auth.users u
on conflict (id) do nothing;

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 使用者只能改自己的顯示名稱，不能改 role（不能自己升管理員）
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ============ 2. 每日計畫（只有本人看得到） ============
create table if not exists public.plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_date  date not null,
  text       text not null check (char_length(text) between 1 and 120),
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists plans_user_date on public.plans (user_id, plan_date);

alter table public.plans enable row level security;

drop policy if exists plans_own on public.plans;
create policy plans_own on public.plans
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.plans from anon;
grant select, insert, update, delete on public.plans to authenticated;

-- ============ 3. 題庫繳交 ============
-- year：民國年；kind：o = 正式賽、m = 模擬賽；q：第幾題（1–6）
create table if not exists public.submissions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year       int  not null check (year between 1 and 300),
  kind       text not null check (kind in ('o', 'm')),
  q          int  not null check (q between 1 and 6),
  file_name  text not null,
  fmt        text not null check (fmt in ('pdf', 'docx')),
  size       bigint not null check (size > 0),
  path       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, year, kind, q)
);

alter table public.submissions enable row level security;

-- 選手看自己的；管理員看全部
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 只能寫自己的，且檔案路徑必須在自己的資料夾底下
drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert on public.submissions
  for insert to authenticated
  with check (user_id = auth.uid() and path like auth.uid()::text || '/%');

drop policy if exists submissions_update on public.submissions;
create policy submissions_update on public.submissions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and path like auth.uid()::text || '/%');

drop policy if exists submissions_delete on public.submissions;
create policy submissions_delete on public.submissions
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.submissions from anon;
grant select, insert, update, delete on public.submissions to authenticated;

-- ============ 4. 設定（題庫起始年度） ============
create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);
insert into public.settings (key, value) values ('start_year', '102'::jsonb)
on conflict (key) do nothing;

alter table public.settings enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings
  for select to authenticated using (true);

drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.settings from anon;
grant select, insert, update, delete on public.settings to authenticated;

-- ============ 5. 檔案儲存桶（私人，不公開） ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submissions', 'submissions', false, 20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 檔案路徑格式：<使用者 id>/<檔名>。第一層資料夾必須是自己的 id。
drop policy if exists submissions_files_select on storage.objects;
create policy submissions_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists submissions_files_insert on storage.objects;
create policy submissions_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists submissions_files_delete on storage.objects;
create policy submissions_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============ 6. 把自己升為管理員（改成你的註冊信箱後，另外執行） ============
-- update public.profiles set role = 'admin' where email = '你的信箱@example.com';
