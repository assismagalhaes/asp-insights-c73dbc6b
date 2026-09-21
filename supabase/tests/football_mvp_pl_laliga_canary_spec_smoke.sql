BEGIN;

DO $smoke$
DECLARE
  target public.hl_training_dataset_specs%ROWTYPE;
  original_count integer;
  target_ids jsonb;
BEGIN
  SELECT spec.* INTO target
  FROM public.hl_training_dataset_specs AS spec
  JOIN public.sports AS sport ON sport.id = spec.sport_id
  WHERE sport.code = 'football'
    AND spec.code = 'football_mvp_pl_laliga_canary'
    AND spec.version = '1.0.0';

  IF target.id IS NULL OR target.status <> 'draft' OR target.is_enabled THEN
    RAISE EXCEPTION 'PL+La Liga canary spec must exist as draft and disabled';
  END IF;

  target_ids := target.quality_contract -> 'competition_external_ids';
  IF target_ids <> '["33973", "119924"]'::jsonb
     OR target_ids ? '84182' THEN
    RAISE EXCEPTION 'temporary canary scope is invalid: %', target_ids;
  END IF;

  IF target.quality_contract #>> '{phase2_gate_required,required_status}' <> 'ready'
     OR COALESCE((target.quality_contract #>> '{phase2_gate_required,bypass_allowed}')::boolean, true)
     OR target.quality_contract -> 'eligible_dataset_states' <> '["READY"]'::jsonb
     OR COALESCE((target.quality_contract ->> 'degraded_rows_allowed')::boolean, true)
     OR COALESCE((target.quality_contract ->> 'automatic_build')::boolean, true)
     OR COALESCE((target.quality_contract ->> 'automatic_training')::boolean, true)
     OR COALESCE((target.quality_contract ->> 'automatic_predictions')::boolean, true) THEN
    RAISE EXCEPTION 'temporary canary safeguards are invalid';
  END IF;

  SELECT count(*) INTO original_count
  FROM public.hl_training_dataset_specs AS spec
  JOIN public.sports AS sport ON sport.id = spec.sport_id
  WHERE sport.code = 'football'
    AND spec.code = 'football_mvp_pl_laliga_j1'
    AND spec.version = '1.0.0'
    AND spec.quality_contract -> 'competition_external_ids' ? '84182';

  IF original_count <> 1 THEN
    RAISE EXCEPTION 'original three-league spec must remain intact';
  END IF;
END
$smoke$;

ROLLBACK;
