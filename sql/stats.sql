-- 사실은 별거 아냐: 숫자로 보는 표 (한 번만 실행하면 됩니다. 다시 실행해도 괜찮아요)
-- 표는 'stats' 칸에 따로 만들어서, 앱 바깥에서는 읽을 수 없습니다.
create schema if not exists stats;
revoke all on schema stats from public, anon, authenticated;

-- 1) 단계별 사람 수: 홈에 온 사람 중 몇 명이 어디까지 갔는지
create or replace view stats."단계별 사람 수" as
with e as (select anon_id, name, created_at from public.events),
steps(n, step, ev) as (values
  (1, '홈 방문', 'home_view'),
  (2, '입력칸 누름', 'field_tap'),
  (3, '시작 안내 동의', 'consent_ok'),
  (4, '글 보냄', 'write_submit'),
  (5, '답 받음', 'answer_ok'),
  (6, '부풀려진 생각 버림', 'discard'),
  (7, '지도 봄', 'map_open')),
total as (select count(distinct anon_id) filter (where created_at > now() - interval '7 days') as w,
                 count(distinct anon_id) as a from e where name = 'home_view')
select s.n as "순서", s.step as "단계",
  count(distinct e.anon_id) filter (where e.created_at > now() - interval '7 days') as "최근 7일",
  round(100.0 * count(distinct e.anon_id) filter (where e.created_at > now() - interval '7 days') / nullif((select w from total), 0)) as "최근 7일 %",
  count(distinct e.anon_id) as "전체",
  round(100.0 * count(distinct e.anon_id) / nullif((select a from total), 0)) as "전체 %"
from steps s left join e on e.name = s.ev
group by s.n, s.step order by s.n;

-- 2) 날짜별 (한국 시간)
create or replace view stats."날짜별" as
select (created_at at time zone 'Asia/Seoul')::date as "날짜",
  count(distinct anon_id) filter (where name = 'home_view') as "방문한 사람",
  count(distinct anon_id) filter (where name = 'write_submit') as "글 쓴 사람",
  count(*) filter (where name = 'write_submit') as "보낸 글",
  count(*) filter (where name = 'answer_ok') as "받은 답",
  count(*) filter (where name = 'answer_fail') as "답 실패",
  count(*) filter (where name = 'answer_retry') as "다른 답 듣기",
  count(*) filter (where name = 'discard') as "버림",
  count(distinct anon_id) filter (where name = 'map_open') as "지도 본 사람"
from public.events group by 1 order by 1 desc;

-- 3) 다시 온 사람: 서로 다른 날 2번 이상 홈에 온 사람
create or replace view stats."다시 온 사람" as
with d as (select anon_id, count(distinct (created_at at time zone 'Asia/Seoul')::date) as days
           from public.events where name = 'home_view' group by anon_id)
select count(*) as "방문한 사람",
  count(*) filter (where days >= 2) as "2일 이상 온 사람",
  round(100.0 * count(*) filter (where days >= 2) / nullif(count(*), 0)) as "다시 온 %"
from d;

-- 4) 답 종류: AI가 어떤 글로 읽었는지
create or replace view stats."답 종류" as
select case reply_type
    when 'small' then '작은 일' when 'pressure' then '눈치 보이는 일' when 'vague' then '애매한 글'
    when 'good' then '좋은 일' when 'off' then '장난·상관없는 말' when 'heavy' then '무거운 일'
    when 'risk' then '위험 신호' when 'skip' then '해를 끼친 일'
    else coalesce(reply_type, '?') || ' (예전 말투)' end as "답 종류",
  count(*) filter (where created_at > now() - interval '7 days') as "최근 7일",
  count(*) as "전체"
from public.entries group by reply_type order by "전체" desc;

-- 5) 설문 응답
create or replace view stats."설문" as
select case q.key when 'lighter' then '1. 마음이 가벼워졌나' when 'tone' then '2. 답의 말투'
    when 'others' then '3. 비슷한 고민 보고 싶나' when 'again' then '4. 또 쓸 것 같나' else q.key end as "질문",
  q.value as "답", count(*) as "응답 수"
from public.surveys s, jsonb_each_text(s.answers::jsonb) q
where s.answers->>'v' is null and s.answers->>'kind' is null  -- 예전 설문만 (새 설문, 답 피드백 제외)
group by 1, 2 order by 1, 3 desc;

-- 6) 지도 반응: 공감과 신고가 많은 고민 (가린 글만)
create or replace view stats."지도 반응" as
select e.masked_text as "고민 (가린 글)", e.created_at as "올린 때",
  (select count(*) from public.likes l where l.entry_id = e.id) as "나도 그래요",
  (select count(*) from public.reports r where r.entry_id = e.id) as "신고",
  e.hidden as "숨김"
from public.entries e
where e.shared and e.masked_text is not null
order by 3 desc, 4 desc limit 50;

revoke all on all tables in schema stats from public, anon, authenticated;

-- 7) 새 설문(v2): 표정 점수 분포
create or replace view stats."설문 만족도" as
select (answers->>'score')::int as "점수",
  case (answers->>'score')::int when 1 then '별로예요' when 2 then '아쉬워요' when 3 then '보통이에요' when 4 then '괜찮아요' when 5 then '좋아요' end as "표정",
  count(*) as "응답 수"
from public.surveys where answers->>'v' = '2'
group by 1, 2 order by 1;

-- 8) 새 설문(v2): 좋았던 점·아쉬웠던 점 칩별 개수
create or replace view stats."설문 칩" as
select '좋았던 점' as "구분",
  case x when 'lighter' then '마음이 가벼워졌어요' when 'sorted' then '생각이 정리됐어요' when 'relate' then '다른 사람 고민이 공감됐어요'
    when 'relief' then '버리는 게 후련했어요' when 'easy' then '쓰기 편했어요' when 'etc' then '기타' else x end as "칩",
  count(*) as "고른 수"
from public.surveys, jsonb_array_elements_text(answers->'good') x where answers->>'v' = '2' group by 2
union all
select '아쉬웠던 점',
  case x when 'mismatch' then '답이 내 상황과 달라요' when 'obvious' then '답이 뻔해요' when 'empathy' then '더 공감해 줬으면'
    when 'real' then '더 현실적이었으면' when 'blank' then '뭘 적어야 할지 모르겠어요' when 'hard' then '쓰기 불편했어요' when 'etc' then '기타' else x end,
  count(*)
from public.surveys, jsonb_array_elements_text(answers->'bad') x where answers->>'v' = '2' group by 2
order by 1, 3 desc;

-- 9) 새 설문(v2): 기타에 적은 말
create or replace view stats."설문 기타" as
select created_at as "언제", (answers->>'score')::int as "점수",
  answers->>'note_good' as "좋았던 점 (기타)", answers->>'note_bad' as "아쉬웠던 점 (기타)"
from public.surveys where answers->>'v' = '2' and (answers ? 'note_good' or answers ? 'note_bad')
order by created_at desc;
