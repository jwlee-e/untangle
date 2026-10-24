-- 2년 지난 화면 이용 기록을 매일 새벽 4시(UTC)쯤 지운다. 적은 글은 지우지 않는다.
create extension if not exists pg_cron;
select cron.schedule('delete-old-events', '0 4 * * *',
  $$delete from events where created_at < now() - interval '2 years'$$);
