# Plano de Ajustes — ASP Insights

Vou implementar todos os ajustes solicitados em blocos coerentes. Abaixo o escopo completo.

## 1. Banco de dados (migração única)

**Nova tabela `ligas`:**
- `id`, `nome` (citext único), `esporte`, `ativo` (default true), `created_at`, `updated_at`
- RLS + GRANTs (authenticated read/write)

**Normalização de dados existentes em `prognosticos`:**
- `NBA → esporte=Basketball, liga=NBA`
- `WNBA → Basketball, WNBA`
- `MLB → Baseball, MLB`
- `NFL → American Football, NFL`
- `NHL → Hockey, NHL`
- Demais valores preservados (Futebol mantém liga existente)

**Correção de datas invertidas** da última importação:
- Identificar prognósticos onde `dia ≤ 12` E `mês ≤ 12` criados recentemente onde provavelmente houve inversão. Como heurística é arriscada, vou aplicar correção apenas em registros importados nos últimos 2 dias onde a data está no futuro do esperado (a partir da `created_at` vs `data`). Vou pedir confirmação na pré-execução listando os registros candidatos via SELECT antes do UPDATE.

**Seed inicial de ligas** a partir dos `prognosticos.liga` distintos existentes.

## 2. Lib compartilhada (`src/lib/db.ts`)

- `ESPORTES_DEFAULT = ["Futebol","Basketball","Baseball","American Football","Hockey"]`
- `MERCADOS_DEFAULT` adiciona `ASP GoalMatrix` e `ASP CornerMatrix`
- Mapa `SPORT_FROM_LEAGUE` para normalização (NBA→Basketball, etc.)
- Hooks: `useLigas()`, `useUpsertLiga()`
- Helper `normalizeEsporteLiga({esporte, liga})` para usar na importação e em qualquer cadastro

## 3. Parser de data brasileira (`src/lib/date-br.ts` — novo)

`parseBrazilianDate(input)` com prioridade:
1. `DD/MM/YYYY` ou `D/M/YYYY`
2. `DD-MM-YYYY`
3. `YYYY-MM-DD` (ISO)
4. Serial Excel (number > 59)

Valida dia 1–31 e mês 1–12. Retorna `YYYY-MM-DD` ou `null`. Helper `formatBR(iso)` para exibição `DD/MM/YYYY`.

Substituir `parseDate` em `importar.tsx` por essa função.

## 4. Importação (`src/routes/_authenticated/importar.tsx`)

- Template CSV inclui `hora` obrigatória
- Validação: `data`, `hora`, `esporte`, `liga`, `jogo`, `mercado`, `pick`, `odd_ofertada`, `odd_valor`, `probabilidade_final`, `edge`, `stake` (obrigatórios)
- Mensagens específicas: "Hora obrigatória não informada", "Liga obrigatória não informada"
- Aplicar `normalizeEsporteLiga` antes de salvar
- Auto-cadastro de ligas novas (upsert na tabela `ligas`)
- **Seleção de linhas**:
  - Checkbox por linha + cabeçalho "Selecionar todos"
  - Botões "Selecionar apenas válidas" / "Limpar seleção"
  - Linhas inválidas não selecionáveis
  - Linhas válidas pré-selecionadas; com alerta também, mas com destaque
  - "Confirmar Importação" usa apenas selecionadas
  - Resumo final conta selecionadas

## 5. Componente `LeagueFilter` (novo)

`<LeagueFilter sport={esporte} value={liga} onChange={...} />` — busca ligas filtradas por esporte (ou todas) e renderiza Select.

## 6. Filtros em todas as telas

Adicionar filtro **Liga** (dependente de Esporte) em:
- Dashboard (`index.tsx`)
- Prognósticos (`prognosticos.tsx`)
- Histórico (`historico.tsx`)
- Estatísticas (`estatisticas.tsx`)
- Validação (`validacao.tsx`)
- Publicação (`publicacao.tsx`)

Garantir que esporte/liga/mercado/período combinem corretamente.

## 7. Exibição data + hora

Onde já mostra data, adicionar hora ao lado. Telas: Prognósticos, Importação (preview), Validação, Publicação, Histórico, Dashboard (últimos prognósticos).

## 8. Bankroll — Controle por stake

Em `bankroll.tsx`, calcular `% da banca` com base em `bancaInicial` (não `bancaAtual`). Texto também atualizado.

## 9. Validação Crítica — coluna Linha

Em `validacao.tsx`, exibir `Linha` quando `prognostico.linha` estiver preenchido, separado de `Pick`. Se `linha` vazio, omitir. Sem concatenar.

## 10. Configurações

- `mercados_ativos`: incluir `ASP GoalMatrix`, `ASP CornerMatrix` nos defaults
- `esportes_ativos`: garantir que só os 5 esportes principais estejam disponíveis

## Arquivos a editar/criar

**Novos:**
- `supabase/migrations/<ts>_ligas_e_normalizacao.sql`
- `src/lib/date-br.ts`
- `src/components/league-filter.tsx`

**Editados:**
- `src/lib/db.ts` (esportes, mercados, mapa normalização, hooks ligas)
- `src/routes/_authenticated/importar.tsx` (parser BR, seleção, validações, normalização, auto-cadastro liga)
- `src/routes/_authenticated/index.tsx` (filtro liga, exibe hora)
- `src/routes/_authenticated/prognosticos.tsx` (filtro liga)
- `src/routes/_authenticated/historico.tsx` (filtro liga, hora)
- `src/routes/_authenticated/estatisticas.tsx` (filtro liga)
- `src/routes/_authenticated/validacao.tsx` (filtro liga, exibe linha, hora)
- `src/routes/_authenticated/publicacao.tsx` (filtro liga, hora)
- `src/routes/_authenticated/bankroll.tsx` (% sobre banca inicial)
- `src/routes/_authenticated/configuracoes.tsx` (lista esportes/mercados atualizada)
- `src/components/prognostico-dialog.tsx` (usar normalização e ligas dinâmicas)

## Ordem de execução

1. Criar migração (ligas + normalização de dados + seed)
2. Após aprovação: criar `date-br.ts`, atualizar `db.ts`
3. Criar `LeagueFilter`
4. Atualizar `importar.tsx` (mais crítico)
5. Atualizar telas de filtro (Dashboard, Prognósticos, Histórico, Estatísticas, Validação, Publicação)
6. Atualizar `bankroll.tsx`, `configuracoes.tsx`, `prognostico-dialog.tsx`

Posso prosseguir?