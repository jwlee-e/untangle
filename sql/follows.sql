-- 두 번째 쪽지(이어서 묻기) 저장. 여러 번 실행해도 괜찮다.
create table if not exists public.follows (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid references public.entries(id) on delete cascade,  -- 첫 고민
  anon_id    text not null,
  question   text,          -- 앱이 물어본 것 (고른 질문)
  text       text not null, -- 덧붙인 글
  reply      text,          -- 그 답
  reply_type text,
  created_at timestamptz not null default now()
);
alter table public.follows enable row level security;  -- 서버 비밀 키로만 읽고 쓴다

-- 적은 고민 표: 두 번째 쪽지도 같이 보이게 (내 테스트 기기는 빠진다)
drop view if exists stats."적은 고민";
create view stats."적은 고민" as
select (e.created_at at time zone 'Asia/Seoul') as "언제",
  e.text as "적은 글",
  case e.reply_type
    when 'small' then '작은 일' when 'pressure' then '눈치 보이는 일' when 'vague' then '애매한 글'
    when 'good' then '좋은 일' when 'off' then '장난·상관없는 말' when 'heavy' then '무거운 일'
    when 'risk' then '위험 신호' when 'skip' then '해를 끼친 일' else coalesce(e.reply_type, '?') end as "답 종류",
  (e.shared and e.masked_text is not null and not e.hidden) as "지도에 보임",
  (select count(*) from public.likes l where l.entry_id = e.id) as "공감",
  e.reply as "받은 답",
  f.question as "두 번째: 고른 질문",
  f.text as "두 번째: 덧붙인 글",
  f.reply as "두 번째: 받은 답"
from public.entries e
left join lateral (select question, text, reply from public.follows x where x.entry_id = e.id order by x.created_at desc limit 1) f on true
where e.anon_id not in (select anon_id from public.test_users)
order by e.created_at desc;

revoke all on all tables in schema stats from public, anon, authenticated;
