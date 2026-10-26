-- 신고 사유 칸과 차단 표. Supabase SQL Editor에서 한 번 실행한다.
alter table public.reports add column if not exists reason text;

create table if not exists public.blocks (
  anon_id      text not null,            -- 차단한 사람
  blocked_anon text not null,            -- 차단당한 사람 (화면에는 절대 내려가지 않는다)
  created_at   timestamptz not null default now(),
  primary key (anon_id, blocked_anon)
);
alter table public.blocks enable row level security;  -- 서버 비밀 키로만 읽고 쓴다
