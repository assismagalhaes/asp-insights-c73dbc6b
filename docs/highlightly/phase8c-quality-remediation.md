# Highlightly Phase 8C — quality remediation

Phase 8C separates historical import health from the seven-day rolling future gate.
It does not fabricate provider data and never converts quarantined WNBA standings
into canonical standings.

## What changes

- `hl_phase7_window_health_v` reads dead jobs and open critical issues from the
  latest observation per sport instead of summing repeated daily snapshots.
- `odds_availability_pct` uses only match IDs for which the collection policy
  actually enqueued an odds job. The original raw coverage remains available for
  diagnostics.
- `hl_highlightly_future_gate_v` aggregates the last seven UTC observation days
  across future-window scopes. Historical scopes do not participate in this gate.
- WNBA league `11847` corruption can be accepted only when the saved issue has
  the exact quarantined fingerprint: 30 rows, one distinct team and an identity
  duplicate. Raw payloads and rejected rows are preserved.
- Dead football statistics jobs can be requeued only when the endpoint and error
  exactly match the known HTTP 521 failure. Each canary job receives one attempt,
  so a repeated 521 returns immediately to `dead` instead of blocking the queue.
- Historical and future slices are finalized as `passed` or
  `completed_with_exceptions`, with `ended_at` and completion metadata.

## Safe rollout order

1. Apply `20260722190000_remediate_highlightly_phase7_quality_gate.sql`.
2. Run `highlightly_phase8c_quality_remediation_smoke.sql` transactionally.
3. Publish the bridge allowlist and synchronize the VM.
4. Inspect the known WNBA candidates:

   ```bash
   python -m scripts.accept_highlightly_quarantined_wnba_standings \
     --scope phase7-20260701-15-all-sports
   ```

5. Accept only those exact candidates:

   ```bash
   python -m scripts.accept_highlightly_quarantined_wnba_standings \
     --scope phase7-20260701-15-all-sports \
     --confirm-accept
   ```

6. After the provider quota resets, inspect the HTTP 521 canary:

   ```bash
   python -m scripts.replay_highlightly_dead_521 \
     --scope phase7-20260701-15-all-sports \
     --max-jobs 10
   ```

7. Execute only the 10-job canary. Continue with the remaining jobs only when
   the report says `recommended_action=continue_bounded_replay` and the success
   rate is at least 80%:

   ```bash
   python -m scripts.replay_highlightly_dead_521 \
     --scope phase7-20260701-15-all-sports \
     --max-jobs 10 \
     --minimum-success-rate 0.80 \
     --confirm-dead-521-replay
   ```

8. Read the rolling future gate without consuming provider quota:

   ```bash
   python -m scripts.check_highlightly_future_gate
   ```

The replay refuses to start when the provider is already enabled, when any
ingestion queue is active, or when the requested canary would cross the 750-call
reserve.
