-- Fase 3 / F3-020..F3-022
-- Contrato de labels exclusivo do MVP de futebol.
-- Mantido em draft e desabilitado: esta migration nao ativa treino,
-- inferencia, publicacao ou liquidacao automatica.

WITH football AS (
  SELECT id
  FROM public.sports
  WHERE code = 'football'
)
INSERT INTO public.hl_label_sets (
  sport_id,
  code,
  version,
  status,
  is_enabled,
  outcome_policy
)
SELECT
  football.id,
  'highlightly_football_postmatch_mvp',
  '2.0.0',
  'draft',
  false,
  jsonb_build_object(
    'contract_version', 'phase3.mvp.2.0.0',
    'scope', 'football_pregame_mvp',
    'eligible_match_statuses', jsonb_build_array('finished'),
    'requires_home_and_away_participants', true,
    'requires_final_score', true,
    'automatic_generation', false,
    'automatic_training', false,
    'automatic_predictions', false,
    'market_availability', jsonb_build_object(
      'full_time_result', 'actionable_when_offered',
      'total_goals', 'actionable_when_line_offered',
      'both_teams_to_score', 'actionable_when_offered',
      'asian_handicap', 'actionable_when_half_line_offered',
      'double_chance', 'blocked_provider_not_offered'
    ),
    'double_chance', jsonb_build_object(
      'desired_selections', jsonb_build_array('1x', 'x2', '12'),
      'label_definition_created', false,
      'synthetic_price_forbidden', true,
      'blocking_code', 'DOUBLE_CHANCE_PRICE_MISSING'
    ),
    'missing_market_policy', 'do_not_block_match',
    'corrections_policy', 'new_label_set_version'
  )
FROM football
ON CONFLICT (sport_id, code, version) DO UPDATE SET
  status = 'draft',
  is_enabled = false,
  outcome_policy = EXCLUDED.outcome_policy,
  updated_at = now();

WITH target AS (
  SELECT label_set.id
  FROM public.hl_label_sets AS label_set
  JOIN public.sports AS sport
    ON sport.id = label_set.sport_id
   AND sport.code = 'football'
  WHERE label_set.code = 'highlightly_football_postmatch_mvp'
    AND label_set.version = '2.0.0'
),
definitions AS (
  SELECT
    'full_time_result'::text AS label_key,
    'full_time_result'::text AS market_family,
    'Resultado final (1X2)'::text AS display_name,
    NULL::numeric AS line_value,
    ARRAY['home', 'draw', 'away']::text[] AS outcome_domain,
    jsonb_build_object(
      'perspective', 'home',
      'settlement', 'compare_final_goals'
    ) AS settlement_spec
  UNION ALL
  SELECT
    'total_goals_' || replace(line_value::text, '.', '_'),
    'total_goals',
    'Total de gols ' || line_value::text,
    line_value,
    ARRAY['over', 'under']::text[],
    jsonb_build_object(
      'settlement', 'compare_total_final_goals',
      'line', line_value,
      'push_policy', 'not_applicable_to_half_lines'
    )
  FROM (
    VALUES
      (1.5::numeric),
      (2.5::numeric),
      (3.5::numeric),
      (4.5::numeric),
      (5.5::numeric)
  ) AS goal_lines(line_value)
  UNION ALL
  SELECT
    'both_teams_to_score',
    'both_teams_to_score',
    'Ambas as equipes marcam',
    NULL::numeric,
    ARRAY['yes', 'no']::text[],
    jsonb_build_object(
      'settlement', 'both_final_goal_totals_above_zero'
    )
  UNION ALL
  SELECT
    'asian_handicap_home_'
      || CASE WHEN line_value < 0 THEN 'minus_' ELSE 'plus_' END
      || replace(abs(line_value)::text, '.', '_'),
    'asian_handicap',
    'Handicap asiatico mandante '
      || CASE WHEN line_value > 0 THEN '+' ELSE '' END
      || line_value::text,
    line_value,
    ARRAY['home_cover', 'away_cover']::text[],
    jsonb_build_object(
      'perspective', 'home',
      'settlement', 'compare_home_goal_difference_plus_line',
      'line', line_value,
      'push_policy', 'not_applicable_to_half_lines'
    )
  FROM (
    SELECT sign_value * magnitude AS line_value
    FROM (VALUES (-1::numeric), (1::numeric)) AS signs(sign_value)
    CROSS JOIN (
      VALUES
        (0.5::numeric),
        (1.5::numeric),
        (2.5::numeric),
        (3.5::numeric),
        (4.5::numeric),
        (5.5::numeric)
    ) AS magnitudes(magnitude)
  ) AS handicap_lines
)
INSERT INTO public.hl_label_definitions (
  label_set_id,
  label_key,
  market_family,
  display_name,
  line_value,
  outcome_domain,
  required_sources,
  settlement_spec,
  status
)
SELECT
  target.id,
  definitions.label_key,
  definitions.market_family,
  definitions.display_name,
  definitions.line_value,
  definitions.outcome_domain,
  ARRAY[
    'sports_matches.status',
    'sports_match_participants.score_data'
  ]::text[],
  definitions.settlement_spec,
  'draft'
FROM target
CROSS JOIN definitions
ON CONFLICT (label_set_id, label_key) DO UPDATE SET
  market_family = EXCLUDED.market_family,
  display_name = EXCLUDED.display_name,
  line_value = EXCLUDED.line_value,
  outcome_domain = EXCLUDED.outcome_domain,
  required_sources = EXCLUDED.required_sources,
  settlement_spec = EXCLUDED.settlement_spec,
  status = 'draft',
  updated_at = now();

COMMENT ON COLUMN public.hl_label_sets.outcome_policy IS
  'Politica versionada do contrato, incluindo mercados indisponiveis que nao podem ser sintetizados.';
