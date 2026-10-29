-- 지도 행동 · 적은 고민 표 (내 테스트 기기는 빠진다). 여러 번 실행해도 괜찮다.

-- 1) 지도 행동: 사람마다 지도에서 무엇을 했는지 (최근 활동 순)
create or replace view stats."지도 행동" as
select left(anon_id, 6) as "사람",
  max(created_at at time zone 'Asia/Seoul')::date as "마지막 날",
  count(*) filter (where name = 'map_open') as "지도 연 횟수",
  coalesce(sum((props->>'sec')::int) filter (where name = 'map_leave'), 0) as "머문 시간(초)",
  count(*) filter (where name = 'marker_open') as "털실 누름",
  count(*) filter (where name = 'marker_open' and props->>'sample' = 'false') as "그중 실제 글",
  bool_or(name = 'map_move') as "지도 움직임",
  bool_or(name = 'sheet_open') as "모아보기 엶",
  count(*) filter (where name = 'list_more') as "더 불러오기",
  count(*) filter (where name = 'like') as "공감",
  count(*) filter (where name in ('hide', 'block', 'report')) as "숨김·차단·신고",
  bool_or(name = 'write_from_map') as "지도에서 쓰기"
from public.events
where anon_id not in (select anon_id from public.test_users)
  and name in ('map_open', 'map_leave', 'marker_open', 'map_move', 'sheet_open', 'list_more', 'like', 'hide', 'block', 'report', 'write_from_map')
group by anon_id
order by max(created_at) desc;

-- 2) 적은 고민: 날짜, 글, 답 종류, 지도에 올라갔는지, 공감 수 (최신 순)
create or replace view stats."적은 고민" as
select (e.created_at at time zone 'Asia/Seoul') as "언제",
  e.text as "적은 글",
  case e.reply_type
    when 'small' then '작은 일' when 'pressure' then '눈치 보이는 일' when 'vague' then '애매한 글'
    when 'good' then '좋은 일' when 'off' then '장난·상관없는 말' when 'heavy' then '무거운 일'
    when 'risk' then '위험 신호' when 'skip' then '해를 끼친 일' else coalesce(e.reply_type, '?') end as "답 종류",
  (e.shared and e.masked_text is not null and not e.hidden) as "지도에 보임",
  (select count(*) from public.likes l where l.entry_id = e.id) as "공감",
  e.reply as "받은 답"
from public.entries e
where e.anon_id not in (select anon_id from public.test_users)
order by e.created_at desc;

revoke all on all tables in schema stats from public, anon, authenticated;
