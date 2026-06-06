
-- ===== Prognósticos =====
CREATE TABLE public.prognosticos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  esporte TEXT NOT NULL,
  liga TEXT NOT NULL,
  jogo TEXT NOT NULL,
  mandante TEXT NOT NULL,
  visitante TEXT NOT NULL,
  mercado TEXT NOT NULL,
  pick TEXT NOT NULL,
  linha TEXT,
  odd_ofertada NUMERIC(8,3) NOT NULL,
  odd_valor NUMERIC(8,3) NOT NULL,
  probabilidade_final NUMERIC(6,4) NOT NULL,
  edge NUMERIC(8,4) NOT NULL,
  stake NUMERIC(8,2) NOT NULL DEFAULT 0,
  status_validacao TEXT NOT NULL DEFAULT 'PENDENTE',
  status_publicacao TEXT NOT NULL DEFAULT 'NAO_PUBLICADO',
  resultado TEXT NOT NULL DEFAULT 'PENDENTE',
  lucro_prejuizo NUMERIC(10,2),
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prognosticos TO anon, authenticated;
GRANT ALL ON public.prognosticos TO service_role;
ALTER TABLE public.prognosticos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access prognosticos" ON public.prognosticos FOR ALL USING (true) WITH CHECK (true);

-- ===== Validações =====
CREATE TABLE public.validacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id UUID NOT NULL REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  decisao TEXT NOT NULL,
  stake_confirmada NUMERIC(8,2),
  justificativa TEXT,
  riscos_identificados TEXT,
  comentarios_analista TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.validacoes TO anon, authenticated;
GRANT ALL ON public.validacoes TO service_role;
ALTER TABLE public.validacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access validacoes" ON public.validacoes FOR ALL USING (true) WITH CHECK (true);

-- ===== Resultados =====
CREATE TABLE public.resultados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prognostico_id UUID NOT NULL REFERENCES public.prognosticos(id) ON DELETE CASCADE,
  resultado TEXT NOT NULL,
  placar_final TEXT,
  odd_fechamento NUMERIC(8,3),
  lucro_prejuizo NUMERIC(10,2) NOT NULL DEFAULT 0,
  data_resultado DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resultados TO anon, authenticated;
GRANT ALL ON public.resultados TO service_role;
ALTER TABLE public.resultados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access resultados" ON public.resultados FOR ALL USING (true) WITH CHECK (true);

-- ===== Bankroll =====
CREATE TABLE public.bankroll_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  banca_inicial NUMERIC(12,2) NOT NULL,
  banca_atual NUMERIC(12,2) NOT NULL,
  valor_unidade NUMERIC(10,2) NOT NULL,
  lucro_acumulado NUMERIC(12,2) NOT NULL DEFAULT 0,
  roi NUMERIC(8,4) NOT NULL DEFAULT 0,
  yield NUMERIC(8,4) NOT NULL DEFAULT 0,
  drawdown NUMERIC(8,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bankroll_historico TO anon, authenticated;
GRANT ALL ON public.bankroll_historico TO service_role;
ALTER TABLE public.bankroll_historico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access bankroll" ON public.bankroll_historico FOR ALL USING (true) WITH CHECK (true);

-- ===== Configurações =====
CREATE TABLE public.configuracoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_plataforma TEXT NOT NULL DEFAULT 'ASP Insights',
  valor_unidade_padrao NUMERIC(10,2) NOT NULL DEFAULT 10,
  banca_inicial NUMERIC(12,2) NOT NULL DEFAULT 1000,
  esportes_ativos TEXT[] NOT NULL DEFAULT ARRAY['Futebol','NBA','WNBA','MLB','NFL','NHL'],
  mercados_ativos TEXT[] NOT NULL DEFAULT ARRAY['Resultado Final','Handicap Asiático','Handicap Europeu','Over/Under','BTTS','Moneyline','Spread','Total de Pontos','Total de Corridas','Total de Escanteios','Player Props'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracoes TO anon, authenticated;
GRANT ALL ON public.configuracoes TO service_role;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open access configuracoes" ON public.configuracoes FOR ALL USING (true) WITH CHECK (true);

-- ===== Updated_at trigger =====
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_prognosticos_updated BEFORE UPDATE ON public.prognosticos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_configuracoes_updated BEFORE UPDATE ON public.configuracoes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== Auto-sync resultado -> prognostico + bankroll =====
CREATE OR REPLACE FUNCTION public.apply_resultado()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  cfg RECORD;
  ultimo RECORD;
  nova_banca NUMERIC(12,2);
  novo_lucro NUMERIC(12,2);
  total_stake NUMERIC(12,2);
  novo_roi NUMERIC(8,4);
  novo_yield NUMERIC(8,4);
  pico NUMERIC(12,2);
  novo_drawdown NUMERIC(8,4);
BEGIN
  -- atualiza prognóstico
  UPDATE public.prognosticos
    SET resultado = NEW.resultado, lucro_prejuizo = NEW.lucro_prejuizo
    WHERE id = NEW.prognostico_id;

  SELECT * INTO cfg FROM public.configuracoes ORDER BY created_at ASC LIMIT 1;
  IF cfg IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO ultimo FROM public.bankroll_historico ORDER BY data DESC, created_at DESC LIMIT 1;

  IF ultimo IS NULL THEN
    nova_banca := cfg.banca_inicial + COALESCE(NEW.lucro_prejuizo,0);
    novo_lucro := COALESCE(NEW.lucro_prejuizo,0);
  ELSE
    nova_banca := ultimo.banca_atual + COALESCE(NEW.lucro_prejuizo,0);
    novo_lucro := ultimo.lucro_acumulado + COALESCE(NEW.lucro_prejuizo,0);
  END IF;

  SELECT COALESCE(SUM(stake),0) INTO total_stake FROM public.prognosticos WHERE resultado <> 'PENDENTE';
  novo_roi := CASE WHEN cfg.banca_inicial > 0 THEN (novo_lucro / cfg.banca_inicial) ELSE 0 END;
  novo_yield := CASE WHEN total_stake > 0 THEN (novo_lucro / (total_stake * cfg.valor_unidade_padrao)) ELSE 0 END;

  SELECT GREATEST(COALESCE(MAX(banca_atual), cfg.banca_inicial), nova_banca) INTO pico FROM public.bankroll_historico;
  novo_drawdown := CASE WHEN pico > 0 THEN ((pico - nova_banca) / pico) ELSE 0 END;

  INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
  VALUES (NEW.data_resultado, cfg.banca_inicial, nova_banca, cfg.valor_unidade_padrao, novo_lucro, novo_roi, novo_yield, novo_drawdown);

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_resultados_apply AFTER INSERT ON public.resultados
  FOR EACH ROW EXECUTE FUNCTION public.apply_resultado();

-- ===== Seed configurações + bankroll inicial =====
INSERT INTO public.configuracoes (nome_plataforma, valor_unidade_padrao, banca_inicial)
VALUES ('ASP Insights', 10, 1000);

INSERT INTO public.bankroll_historico (data, banca_inicial, banca_atual, valor_unidade, lucro_acumulado, roi, yield, drawdown)
VALUES (CURRENT_DATE, 1000, 1000, 10, 0, 0, 0, 0);
