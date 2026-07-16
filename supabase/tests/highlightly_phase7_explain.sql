-- Run after the Phase 7 tables contain representative shadow data.
-- These are read-only EXPLAIN ANALYZE probes; review execution time, buffers,
-- sequential scans on large tables, rows removed by filter, and external sorts.

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, status, endpoint_key, scheduled_at
FROM public.hl_ingestion_jobs
WHERE shadow_scope = 'replace-with-phase7-scope'
  AND sport = 'football'
  AND status IN ('pending', 'retry', 'running')
ORDER BY created_at DESC
LIMIT 200;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM public.hl_phase7_window_health_v
WHERE scope = 'replace-with-phase7-scope';

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM public.sports_football_match_summary_v
WHERE kickoff_at >= current_date::timestamptz
  AND kickoff_at < (current_date + 1)::timestamptz
ORDER BY kickoff_at, match_id
LIMIT 200;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM public.sports_baseball_match_summary_v
WHERE kickoff_at >= current_date::timestamptz
  AND kickoff_at < (current_date + 1)::timestamptz
ORDER BY kickoff_at, match_id
LIMIT 200;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM public.sports_basketball_match_summary_v
WHERE kickoff_at >= current_date::timestamptz
  AND kickoff_at < (current_date + 1)::timestamptz
ORDER BY kickoff_at, match_id
LIMIT 200;
