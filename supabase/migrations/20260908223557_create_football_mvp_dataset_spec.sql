-- Fase 3 / F3-030
-- Spec de dataset restrito a Premier League, La Liga e J1 League.
-- O spec nasce em draft/desabilitado e nao materializa linhas.

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
  'football_mvp_pl_laliga_j1',
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
    'quality_contract_version', 'phase3.mvp.1.0.0',
    'sport', 'football',
    'provider', 'highlightly',
    'competition_external_ids', jsonb_build_array(
      '33973',
      '119924',
      '84182'
    ),
    'competition_names', jsonb_build_array(
      'Premier League',
      'La Liga',
      'J1 League'
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
      'label_version',
        'highlightly_football_postmatch_mvp.2.0.0',
      'required_definition_count', 19,
      'double_chance_actionable', false
    ),
    'identity_required', jsonb_build_array(
      'match_id',
      'competition_id',
      'season_id',
      'home_team_id',
      'away_team_id'
    ),
    'missingness_contract', 'football_input_quality@1.0.0',
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
