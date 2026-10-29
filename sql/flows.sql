-- 한 사람이 앱에서 한 일을 순서대로 보기. 여러 번 실행해도 괜찮다. (내 테스트 기기는 빠진다)
-- 30분 넘게 아무것도 안 하다가 다시 오면 새 방문으로 센다.

-- 이벤트 이름 → 읽기 쉬운 말
create or replace function stats.ev_label(n text, p jsonb) returns text language sql immutable as $$
  select case n
    when 'home_view' then '홈 열기'
    when 'field_tap' then '입력칸 누름'
    when 'consent_ok' then '시작 안내 동의'
    when 'consent_later' then '시작 안내 거절'
    when 'write_submit' then '글 보냄'
    when 'answer_ok' then '답 받음'
    when 'answer_fail' then '답 실패'
    when 'answer_retry' then '다른 답 듣기'
    when 'written_toggle' then '내 글 펼치기'
    when 'follow_open' then '아직 신경 쓰여요'
    when 'follow_chip' then '두 번째: 질문 고름'
    when 'follow_submit' then '두 번째: 글 보냄'
    when 'follow_ok' then '두 번째: 답 받음'
    when 'follow_fail' then '두 번째: 답 실패'
    when 'follow_cancel' then '두 번째: 취소'
    when 'feedback_open' then '도움이 안 됐어요 열기'
    when 'answer_feedback' then '도움이 안 됐어요 보냄'
    when 'discard' then '버림'
    when 'close' then '닫기 (' || coalesce(p->>'from', '') || ')'
    when 'yarn_poke' then '홈 털실 건드림'
    when 'map_open' then '지도 열기'
    when 'map_return' then '지도로 돌아옴'
    when 'map_move' then '지도 움직임'
    when 'marker_open' then case when p->>'sample' = 'true' then '털실 누름 (예시)' else '털실 누름 (실제 글)' end
    when 'map_leave' then '지도 나감 · ' || coalesce(p->>'sec', '?') || '초, 털실 ' || coalesce(p->>'markers', '0') || '개'
    when 'sheet_open' then '모아보기 열기'
    when 'sheet_full' then '모아보기 끝까지 펼침'
    when 'list_more' then '모아보기 더 불러오기'
    when 'like' then '공감'
    when 'unlike' then '공감 취소'
    when 'more_open' then '더보기 열기'
    when 'hide' then '숨기기'
    when 'block' then '차단'
    when 'report' then '신고'
    when 'report_open' then '신고 창 열기'
    when 'write_from_map' then '지도에서 내 고민 꺼내기'
    when 'survey_open' then '설문 열기'
    when 'survey_send' then '설문 보냄'
    when 'settings_open' then '설정 열기'
    when 'about_open' then '이야기 페이지 열기'
    when 'share_toggle' then case when p->>'on' = 'true' then '공유 켬' else '공유 끔' end
    else n end
$$;

-- 1) 사람별 흐름: 한 줄이 행동 하나. 사람 → 방문 → 시간 순
create or replace view stats."사람별 흐름" as
with e as (
  select anon_id, name, props::jsonb as p, created_at,
    lag(created_at) over (partition by anon_id order by created_at) as prev
  from public.events where anon_id not in (select anon_id from public.test_users)
), s as (
  select *, sum(case when prev is null or created_at - prev > interval '30 minutes' then 1 else 0 end)
              over (partition by anon_id order by created_at) as visit
  from e
)
select left(anon_id, 6) as "사람", visit as "방문", to_char(created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') as "시각",
  case when prev is null or created_at - prev > interval '30 minutes' then null else extract(epoch from created_at - prev)::int end as "앞 행동 뒤(초)",
  stats.ev_label(name, p) as "한 일"
from s order by anon_id, created_at;

-- 2) 방문 요약: 한 줄이 방문 한 번. 무엇을 거쳐 어디서 끝났는지 (최근 방문 순)
create or replace view stats."방문 요약" as
with e as (
  select anon_id, name, props::jsonb as p, created_at,
    lag(created_at) over (partition by anon_id order by created_at) as prev
  from public.events where anon_id not in (select anon_id from public.test_users)
), s as (
  select *, sum(case when prev is null or created_at - prev > interval '30 minutes' then 1 else 0 end)
              over (partition by anon_id order by created_at) as visit
  from e
)
select left(anon_id, 6) as "사람", visit as "방문",
  to_char(min(created_at) at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "시작",
  extract(epoch from max(created_at) - min(created_at))::int as "머문 시간(초)",
  count(*) as "행동 수",
  (array_agg(stats.ev_label(name, p) order by created_at desc))[1] as "마지막 행동",
  string_agg(stats.ev_label(name, p), ' → ' order by created_at) filter (where name not in ('yarn_poke', 'written_toggle')) as "흐름"
from s group by anon_id, visit
order by min(created_at) desc;

revoke all on all tables in schema stats from public, anon, authenticated;
revoke all on function stats.ev_label(text, jsonb) from public, anon, authenticated;
