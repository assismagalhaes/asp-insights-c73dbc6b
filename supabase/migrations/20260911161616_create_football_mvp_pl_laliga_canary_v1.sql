-- Fase 3 / F3-032 preparation.
-- Temporary first-canary scope approved on 2026-09-11: Premier League + La Liga.
-- J1 League remains in prospective incubation under the original three-league spec.
-- This migration creates no build, feature snapshot, label, training row or prediction.

INSERT INTO public.hl_training_dataset_specs (
  sport_id,
  code,
  version,
  feature_set_id,
  label_set_id,
  label_version,
  horizon_key,
  status,
  is_enabled,
  minimum_coverage_pct,
  split_policy,
  quality_contract
)
SELECT
  sport.id,
  'football_mvp_pl_laliga_canary',
  '1.0.0',
  feature_set.id,
  label_set.id,
  'highlightly_football_postmatch_mvp.2.0.0',
  't24h',
  'draft',
  false,
  70,
  jsonb_build_object(
    'strategy', 'temporal_ordered',
    'shuffle', false,
    'train_pct', 70,
    'validation_pct', 15,
    'test_pct', 15,
    'ordering', jsonb_build_array('kickoff_at', 'match_id'),
    'scope', 'per_build_run',
    'same_match_single_split', true
  ),
  jsonb_build_object(
    'quality_contract_version', 'phase3.mvp.pl_laliga_canary.1.0.0',
    'sport', 'football',
    'provider', 'highlightly',
    'scope_kind', 'temporary_first_canary',
    'approved_at', '2026-09-11',
    'competition_external_ids', jsonb_build_array('33973', '119924'),
    'competition_names', jsonb_build_array('Premier League', 'La Liga'),
    'excluded_incubating_competitions', jsonb_build_array(
      jsonb_build_object(
        'external_id', '84182',
        'name', 'J1 League',
        'reason', 'prospective_point_in_time_history_not_mature'
      )
    ),
    'phase2_gate_required', jsonb_build_object(
      'rpc', 'get_highlightly_football_canary_gate_v1',
      'required_status', 'ready',
      'required_days', 14,
      'bypass_allowed', false
    ),
    'feature_set', jsonb_build_object(
      'code', feature_set.code,
      'version', feature_set.version,
      'horizon', 't24h',
      'source_max_at_lte_cutoff', true,
      'target_match_facts_used', false
    ),
    'label_set', jsonb_build_object(
      'code', label_set.code,
      'version', label_set.version,
      'label_version', 'highlightly_football_postmatch_mvp.2.0.0',
      'required_definition_count', 19,
      'double_chance_actionable', false
    ),
    'eligible_dataset_states', jsonb_build_array('READY'),
    'degraded_rows_allowed', false,
    'provider_calls', 0,
    'automatic_build', false,
    'automatic_training', false,
    'automatic_predictions', false
  )
FROM public.sports AS sport
JOIN public.hl_feature_sets AS feature_set
  ON feature_set.sport_id = sport.id
 AND feature_set.code = 'highlightly_football_prematch'
 AND feature_set.version = '2.0.0'
JOIN public.hl_label_sets AS label_set
  ON label_set.sport_id = sport.id
 AND label_set.code = 'highlightly_football_postmatch_mvp'
 AND label_set.version = '2.0.0'
WHERE sport.code = 'football'
ON CONFLICT (sport_id, code, version) DO UPDATE SET
  feature_set_id = EXCLUDED.feature_set_id,
  label_set_id = EXCLUDED.label_set_id,
  label_version = EXCLUDED.label_version,
  horizon_key = EXCLUDED.horizon_key,
  status = 'draft',
  is_enabled = false,
  minimum_coverage_pct = EXCLUDED.minimum_coverage_pct,
  split_policy = EXCLUDED.split_policy,
  quality_contract = EXCLUDED.quality_contract,
  updated_at = now();
