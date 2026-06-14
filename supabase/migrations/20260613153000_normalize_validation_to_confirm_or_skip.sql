-- Simplify validation decisions to the current human workflow:
-- CONFIRMA or PULAR. Keep data, only normalize legacy labels.

UPDATE public.prognosticos
SET status_validacao = 'PULAR'
WHERE status_validacao IN (
  'CONFIRMA_CAUTELA',
  'CONFIRMA COM CAUTELA',
  'AGUARDAR_NOTICIA',
  'AGUARDAR NOTICIA',
  'AGUARDAR NOTÍCIA',
  'PASS'
);

UPDATE public.validacoes
SET decisao = 'PULAR'
WHERE decisao IN (
  'CONFIRMA_CAUTELA',
  'CONFIRMA COM CAUTELA',
  'AGUARDAR_NOTICIA',
  'AGUARDAR NOTICIA',
  'AGUARDAR NOTÍCIA',
  'PASS'
);
