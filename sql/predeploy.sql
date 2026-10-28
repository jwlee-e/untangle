-- 배포 전에 한 번 실행한다. Supabase → SQL Editor에 통째로 붙여 넣고 Run.
-- 여러 번 실행해도 괜찮다(이미 있으면 건너뛰거나 덮어쓴다).

-- 1) 신고에서 '기타'를 고르고 적은 말
alter table public.reports add column if not exists note text;

-- 2) 설문 만족도 표: '조금 아쉬워요' → '아쉬워요'
create or replace view stats."설문 만족도" as
select (answers->>'score')::int as "점수",
  case (answers->>'score')::int when 1 then '별로예요' when 2 then '아쉬워요' when 3 then '보통이에요' when 4 then '괜찮아요' when 5 then '좋아요' end as "표정",
  count(*) as "응답 수"
from public.surveys where answers->>'v' = '2'
group by 1, 2 order by 1;

-- 3) 하루 이용 횟수: 서버가 여러 대여도 숫자가 이어지게 저장소에 센다
--    key는 'a:익명번호' 또는 'i:IP를 바꾼 값(해시)'. 원래 IP는 저장하지 않는다. 지난 날짜 줄은 부를 때마다 지운다
create table if not exists public.daily_hits (
  day date not null,
  key text not null,
  n   int  not null default 0,
  primary key (day, key)
);
alter table public.daily_hits enable row level security;  -- 서버 비밀 키로만 쓴다

create or replace function public.hit_daily(p_key text) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Seoul')::date; v int;
begin
  delete from public.daily_hits where day < d;
  insert into public.daily_hits (day, key, n) values (d, p_key, 1)
  on conflict (day, key) do update set n = public.daily_hits.n + 1
  returning n into v;
  return v;
end $$;
revoke all on function public.hit_daily(text) from public, anon, authenticated;
grant execute on function public.hit_daily(text) to service_role;

-- 4) 신고 모아 보기: 신고가 들어온 고민과 사유, 숨겨졌는지
create or replace view stats."신고 목록" as
select e.masked_text as "고민 (가린 글)", count(*) as "신고 수",
  string_agg(distinct coalesce(r.reason, '사유 없음'), ', ') as "사유",
  string_agg(nullif(r.note, ''), ' / ') as "기타에 적은 말",
  e.hidden as "숨김", e.created_at as "쓴 때"
from public.reports r join public.entries e on e.id = r.entry_id
group by e.id, e.masked_text, e.hidden, e.created_at
order by count(*) desc, e.created_at desc;
