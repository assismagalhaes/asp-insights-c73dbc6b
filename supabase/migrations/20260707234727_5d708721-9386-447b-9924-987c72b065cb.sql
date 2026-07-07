GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_mlb_daily_snapshots TO authenticated;
GRANT ALL ON public.asp_screener_mlb_daily_snapshots TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_mlb_opportunity_snapshots TO authenticated;
GRANT ALL ON public.asp_screener_mlb_opportunity_snapshots TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asp_screener_validator_handoffs TO authenticated;
GRANT ALL ON public.asp_screener_validator_handoffs TO service_role;