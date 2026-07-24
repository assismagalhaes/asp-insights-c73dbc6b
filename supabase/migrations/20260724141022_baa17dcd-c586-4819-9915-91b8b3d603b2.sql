-- Phase 4A: persist operational telemetry for every AI validation run.
-- Additive migration: historical rows remain valid and receive only a run_id.

ALTER TABLE public.analises_ia
  ADD COLUMN IF NOT EXISTS run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS schema_version text NULL,
  ADD COLUMN IF NOT EXISTS arbiter_version text NULL,
  ADD COLUMN IF NOT EXISTS provider text NULL,
  ADD COLUMN IF NOT EXISTS model_id text NULL,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS latency_ms bigint NULL,
  ADD COLUMN IF NOT EXISTS finish_reason text NULL,
  ADD COLUMN IF NOT EXISTS input_tokens bigint NULL,
  ADD COLUMN IF NOT EXISTS output_tokens bigint NULL,
  ADD COLUMN IF NOT EXISTS total_tokens bigint NULL,
  ADD COLUMN IF NOT EXISTS parse_status text NULL,
  ADD COLUMN IF NOT EXISTS error_code text NULL,
  ADD COLUMN IF NOT EXISTS model_decision text NULL,
  ADD COLUMN IF NOT EXISTS final_decision text NULL,
  ADD COLUMN IF NOT EXISTS blocking_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS repair_attempted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS search_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scrape_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.analises_ia
  DROP CONSTRAINT IF EXISTS analises_ia_latency_nonnegative,
  ADD CONSTRAINT analises_ia_latency_nonnegative
    CHECK (latency_ms IS NULL OR latency_ms >= 0) NOT VALID,
  DROP CONSTRAINT IF EXISTS analises_ia_tokens_nonnegative,
  ADD CONSTRAINT analises_ia_tokens_nonnegative
    CHECK (
      (input_tokens IS NULL OR input_tokens >= 0)
      AND (output_tokens IS NULL OR output_tokens >= 0)
      AND (total_tokens IS NULL OR total_tokens >= 0)
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS analises_ia_trace_counts_nonnegative,
  ADD CONSTRAINT analises_ia_trace_counts_nonnegative
    CHECK (search_count >= 0 AND scrape_count >= 0 AND source_count >= 0) NOT VALID,
  DROP CONSTRAINT IF EXISTS analises_ia_timing_order,
  ADD CONSTRAINT analises_ia_timing_order
    CHECK (started_at IS NULL OR finished_at IS NULL OR finished_at >= started_at) NOT VALID,
  DROP CONSTRAINT IF EXISTS analises_ia_parse_status_valid,
  ADD CONSTRAINT analises_ia_parse_status_valid
    CHECK (
      parse_status IS NULL
      OR parse_status IN ('VALID', 'FAILED', 'LEGACY_ROLLBACK')
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS analises_ia_model_decision_valid,
  ADD CONSTRAINT analises_ia_model_decision_valid
    CHECK (model_decision IS NULL OR model_decision IN ('CONFIRMA', 'PULAR')) NOT VALID,
  DROP CONSTRAINT IF EXISTS analises_ia_final_decision_valid,
  ADD CONSTRAINT analises_ia_final_decision_valid
    CHECK (final_decision IS NULL OR final_decision IN ('CONFIRMA', 'PULAR')) NOT VALID;

ALTER TABLE public.analises_ia
  VALIDATE CONSTRAINT analises_ia_latency_nonnegative,
  VALIDATE CONSTRAINT analises_ia_tokens_nonnegative,
  VALIDATE CONSTRAINT analises_ia_trace_counts_nonnegative,
  VALIDATE CONSTRAINT analises_ia_timing_order,
  VALIDATE CONSTRAINT analises_ia_parse_status_valid,
  VALIDATE CONSTRAINT analises_ia_model_decision_valid,
  VALIDATE CONSTRAINT analises_ia_final_decision_valid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_analises_ia_run_id
  ON public.analises_ia(run_id);
CREATE INDEX IF NOT EXISTS idx_analises_ia_observability_time
  ON public.analises_ia(created_at DESC, model_id, modo_ia);
CREATE INDEX IF NOT EXISTS idx_analises_ia_parse_status
  ON public.analises_ia(parse_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analises_ia_error_code
  ON public.analises_ia(error_code, created_at DESC)
  WHERE error_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analises_ia_blocking_codes
  ON public.analises_ia USING gin(blocking_codes);

ALTER TABLE public.analises_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_ia_resultados ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analises_ia FROM anon;
REVOKE ALL ON TABLE public.feedback_ia_resultados FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analises_ia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.feedback_ia_resultados TO authenticated;
GRANT ALL ON TABLE public.analises_ia TO service_role;
GRANT ALL ON TABLE public.feedback_ia_resultados TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

DROP POLICY IF EXISTS "admins manage analises_ia" ON public.analises_ia;
DROP POLICY IF EXISTS "authenticated manage analises_ia" ON public.analises_ia;
DROP POLICY IF EXISTS "Admins manage analises_ia" ON public.analises_ia;
DROP POLICY IF EXISTS "Admins read analises_ia" ON public.analises_ia;
DROP POLICY IF EXISTS "Admins insert analises_ia" ON public.analises_ia;
DROP POLICY IF EXISTS "Admins update analises_ia" ON public.analises_ia;
DROP POLICY IF EXISTS "Admins delete analises_ia" ON public.analises_ia;

CREATE POLICY "Admins read analises_ia"
  ON public.analises_ia
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY "Admins insert analises_ia"
  ON public.analises_ia
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY "Admins update analises_ia"
  ON public.analises_ia
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY "Admins delete analises_ia"
  ON public.analises_ia
  FOR DELETE
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

DROP POLICY IF EXISTS "admins manage feedback_ia_resultados" ON public.feedback_ia_resultados;
DROP POLICY IF EXISTS "authenticated manage feedback_ia_resultados" ON public.feedback_ia_resultados;
DROP POLICY IF EXISTS "Admins manage feedback_ia_resultados" ON public.feedback_ia_resultados;
DROP POLICY IF EXISTS "Admins read feedback_ia_resultados" ON public.feedback_ia_resultados;
DROP POLICY IF EXISTS "Admins insert feedback_ia_resultados" ON public.feedback_ia_resultados;
DROP POLICY IF EXISTS "Admins update feedback_ia_resultados" ON public.feedback_ia_resultados;
DROP POLICY IF EXISTS "Admins delete feedback_ia_resultados" ON public.feedback_ia_resultados;

CREATE POLICY "Admins read feedback_ia_resultados"
  ON public.feedback_ia_resultados
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY "Admins insert feedback_ia_resultados"
  ON public.feedback_ia_resultados
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY "Admins update feedback_ia_resultados"
  ON public.feedback_ia_resultados
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY "Admins delete feedback_ia_resultados"
  ON public.feedback_ia_resultados
  FOR DELETE
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

REVOKE EXECUTE ON FUNCTION public.sync_ai_learning_feedback()
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.analises_ia.run_id IS
  'Unique correlation id for one AI validation generation and arbitration run.';
COMMENT ON COLUMN public.analises_ia.model_decision IS
  'Decision declared by the validated model output before deterministic arbitration.';
COMMENT ON COLUMN public.analises_ia.final_decision IS
  'Operational decision after deterministic arbitration.';
COMMENT ON COLUMN public.analises_ia.blocking_codes IS
  'Deterministic arbiter and provider error codes; never provider secret text.';