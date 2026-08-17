-- Drain expired Highlightly bridge replay-protection nonces without a large
-- one-shot DELETE. Once the backlog is gone, each run only removes rows that
-- expired since the previous interval.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'prune-highlightly-ingestion-bridge-nonces',
  '*/5 * * * *',
  $cron$
    select public.prune_highlightly_ingestion_bridge_nonces(
      clock_timestamp(),
      2000
    );
  $cron$
);
