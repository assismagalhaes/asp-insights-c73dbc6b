# Plano: Grande atualização do módulo de Validação Crítica

Trabalho extenso. Divido em fases entregáveis. Confirme antes de eu começar; depois executo tudo de uma vez.

## Fase 1 — Banco de dados (migration única)

Adicionar em `prognosticos`:
- `odd_original numeric` (preenchido a partir de `odd_ofertada` existente via backfill)
- `odd_ajustada numeric null`
- `edge_original numeric` (backfill de `edge`)
- `edge_ajustado numeric null`
- `dados_tecnicos text null` (mantém `observacoes` como fallback de leitura)

Adicionar em `validacoes`:
- `parecer_validacao text` (backfill concatenando `justificativa` + `riscos_identificados` + `comentarios_analista`)
- `contexto_adicional text null`
- `parecer_ia text null`
- `decisao_ia_sugerida text null`
- `stake_ia_sugerida numeric null`
- `data_analise_ia timestamptz null`
- `prompt_versao text null`

Novo enum `Status` aceita: `CONFIRMA`, `CONFIRMA_CAUTELA`, `PASS`, `AGUARDAR_NOTICIA` (mapeio o antigo `PULAR` → `PASS` em UI; mantém valores antigos como compatíveis).

Atualizar `apply_resultado` para usar `odd_ajustada ?? odd_original` quando necessário (sem mudar fórmula de lucro, que usa stake×odd no cálculo do `resultado-calc.ts` do cliente — apenas garante leitura consistente).

## Fase 2 — Tela Validação Crítica (`validacao.tsx`)

Reorganizar em blocos:
1. Cabeçalho (data/hora/esporte/liga/jogo/status)
2. Dados do prognóstico (mercado, pick, linha, odd original, odd ajustada editável, odd valor, probabilidade, edge original, edge ajustado calculado em tempo real, stake sugerida)
3. Dados Técnicos do Modelo (expansível, mostra `dados_tecnicos ?? observacoes`)
4. Contexto adicional para análise (textarea)
5. IA: botão "Analisar com IA" + painel de resultado com ações (Aplicar/Copiar/Descartar/Regerar) — apenas se LOVABLE_API_KEY presente
6. Parecer da Validação (textarea grande, template Tese/Riscos/Invalidação/Decisão/Stake)
7. Decisão final: 4 botões (CONFIRMA / CONFIRMA COM CAUTELA / PASS / AGUARDAR NOTÍCIA) + select stake (0.5/1.0/1.5)

Recalcular `edge_ajustado` no onChange da odd ajustada com a fórmula informada.

## Fase 3 — Server function de IA

Criar `src/lib/validacao-ia.functions.ts`:
- `createServerFn` POST com `requireSupabaseAuth`
- Recebe `{ prognostico, dados_tecnicos, contexto_adicional }`
- Chama Lovable AI Gateway (`google/gemini-3-flash-preview`) com o prompt fixo do briefing
- Retorna `{ parecer, decisao_sugerida, stake_sugerida, prompt_versao }`
- Sem busca online, apenas analisa o payload recebido

Registrar provider helper em `src/lib/ai-gateway.server.ts` (se não existir).

## Fase 4 — Propagação nas outras telas

- **Prognósticos**: botão/ícone "Dados Técnicos" por linha → Popover/Dialog com conteúdo. Mostrar coluna odd_ajustada quando existir (fallback odd_original).
- **Publicação**: TIP gerada no novo template com `dados_tecnicos`, `parecer_validacao`, odd/edge ajustados. Manter editor de texto antes de copiar.
- **Histórico**: mesma coluna/botão Dados Técnicos.
- **Modal de detalhes** (`prognostico-dialog.tsx`): exibir dados técnicos + parecer + odd original/ajustada.
- **Importação**: aceitar coluna `dados_tecnicos` (prioridade) + fallback `observacoes`. Atualizar template CSV.

## Fase 5 — Limpeza e compatibilidade

- Em `db.ts`: estender types `Prognostico` e `Validacao`, helper `getDadosTecnicos(p)` e `getOddEfetiva(p)`, `getEdgeEfetivo(p)`.
- `StatusBadge`: adicionar variantes `CONFIRMA_CAUTELA`, `PASS`, `AGUARDAR_NOTICIA` (PULAR continua existindo para registros antigos).
- Manter leitura dos campos antigos (`justificativa`, `observacoes`) como fallback exibido se `parecer_validacao`/`dados_tecnicos` vazios.

## Detalhes técnicos

- Edge ajustado calculado client-side via `((prob/100) * odd - 1) * 100`, salvo no submit.
- IA é **opcional**: se a server function falhar (sem chave, 402, 429), exibo erro inline no painel sem bloquear a decisão manual.
- Sem mudanças em: importação de datas BR, bankroll, resultado-calc, autenticação, fluxo de publicação atual além do template da TIP.

## Fora de escopo (confirme se quer agora)

- Renomear coluna `observacoes` → `dados_tecnicos` no banco (mantenho ambas, leitura prioriza `dados_tecnicos`). Renomear quebra histórico e exportações; prefiro coexistência.
- Busca online / scraping — explicitamente **não** será implementado conforme briefing.

Confirmar para eu executar tudo (migration + código) numa sequência só.