UPDATE public.prognosticos
SET origem_modelo = CASE origem_modelo
  WHEN 'Futebol' THEN 'ASP MatchMatrix'
  WHEN 'Baseball' THEN 'ASP Diamond'
  WHEN 'Basketball NBA' THEN 'ASP Court'
  WHEN 'Basketball WNBA' THEN 'ASP Court W'
  ELSE origem_modelo
END
WHERE origem_modelo IN ('Futebol', 'Baseball', 'Basketball NBA', 'Basketball WNBA');
