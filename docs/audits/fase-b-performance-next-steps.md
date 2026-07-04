# Fase B - Proximos passos de performance

Este documento registra achados de performance para uma fase futura. A Fase B nao implementa estas mudancas para evitar regressao nos fluxos criticos do ASP Insights.

## Achados

- O ASP Screener pode buscar ate 20000 odds em uma unica consulta.
- Snapshots do Screener podem carregar ate 1500 oportunidades por vez.
- O ASP Validator ainda usa `select("*").limit(500)` para registros recentes.
- `src/routes/_authenticated/asp-validator.tsx` tem aproximadamente 276 KB.
- `src/routes/_authenticated/asp-screener.tsx` tem aproximadamente 171 KB.
- O build aponta chunks grandes, incluindo `exceljs`.

## Recomendacoes para a proxima fase

1. Implementar paginacao real nas odds do Screener, preservando filtros atuais.
2. Trocar `select("*")` no ASP Validator por colunas explicitas.
3. Paginar oportunidades de snapshots e carregar detalhes sob demanda.
4. Avaliar lazy loading para Excel/importacoes e telas que dependem de bibliotecas grandes.
5. Extrair `asp-validator.tsx` gradualmente por responsabilidade: queries, formularios, OCR, resultado e handoff.
6. Extrair `asp-screener.tsx` gradualmente por paineis: odds, standings, oportunidades, snapshots, auditoria e calibracao.
7. Memoizar calculos pesados que dependem de listas grandes, mantendo dependencias explicitas.
8. Mover filtros para o servidor quando reduzirem volume de dados sem mudar regra de negocio.

## Fora de escopo nesta fase

- Refatoracao ampla de componentes.
- Mudanca de regra de negocio.
- Mudanca de calculo de bankroll.
- Alteracao visual relevante.
- Limpeza ou remocao de dados.
