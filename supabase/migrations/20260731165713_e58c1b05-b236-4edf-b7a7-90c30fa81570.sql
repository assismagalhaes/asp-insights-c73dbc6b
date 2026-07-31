DO $$
DECLARE
  v_affected integer;
BEGIN
  UPDATE public.model_input_contracts
  SET adapter_contract = jsonb_build_object(
        'format', 'model_wide_v1',
        'base', jsonb_build_array('date','time','home','away'),
        'markets', jsonb_build_array('moneyline','totals','runline')
      )
  WHERE contract_key = 'asp_diamond_v1'
    AND adapter_contract = '{"format":"model_wide_v1","base":["date","time","league","home","away"],"markets":["moneyline","totals","run_line"]}'::jsonb;

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'Esperado exatamente 1 registro afetado em asp_diamond_v1, obtido %', v_affected;
  END IF;
END
$$;