BEGIN;

DO $test$
DECLARE
  target public.hl_training_dataset_specs%ROWTYPE;
  competition_ids jsonb;
BEGIN
  SELECT dataset_spec.* INTO target
  FROM public.hl_training_dataset_specs AS dataset_spec
  JOIN public.sports AS sport ON sport.id = dataset_spec.sport_id
  WHERE sport.code = 'football'
    AND dataset_spec.code = 'football_mvp_pl_laliga_j1'
    AND dataset_spec.version = '1.0.0';

  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Football MVP dataset spec was not created';
  END IF;

  IF target.status <> 'draft' OR target.is_enabled THEN
    RAISE EXCEPTION 'Dataset spec must remain draft and disabled';
  END IF;

  IF target.horizon_key <> 't24h'
     OR target.minimum_coverage_pct <> 70 THEN
    RAISE EXCEPTION 'Unexpected horizon or minimum coverage';
  END IF;

  competition_ids := target.quality_contract
    -> 'competition_external_ids';

  IF competition_ids <> '["33973", "119924", "84182"]'::jsonb THEN
    RAISE EXCEPTION 'Unexpected MVP competition scope: %', competition_ids;
  END IF;

  IF target.quality_contract #>> '{feature_set,version}' <> '2.0.0'
     OR target.quality_contract #>> '{label_set,version}' <> '2.0.0'
     OR (target.quality_contract #>>
       '{label_set,double_chance_actionable}')::boolean
       IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Feature/label contract linkage is invalid';
  END IF;

  IF (target.split_policy ->> 'shuffle')::boolean IS DISTINCT FROM false
     OR (target.split_policy ->> 'same_match_single_split')::boolean
       IS DISTINCT FROM true
     OR (target.split_policy ->> 'train_pct')::integer
       + (target.split_policy ->> 'validation_pct')::integer
       + (target.split_policy ->> 'test_pct')::integer <> 100 THEN
    RAISE EXCEPTION 'Temporal split policy is invalid';
  END IF;
END
$test$;

ROLLBACK;
