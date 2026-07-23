# Fase 0 — baseline da validação crítica por IA

Data: 2026-07-23
Commit base: `eea407dba47a08bcca268a7f454898beb427c0e6`

## Escopo

Este baseline cobre as duas validações existentes:

- `src/lib/validacao-ia.functions.ts`;
- `src/lib/validacao-ia-online.functions.ts`.

A extração do parser nesta fase preserva o comportamento legado. Ela não altera prompts, decisões,
stakes, persistência, gates matemáticos nem regras operacionais.

## Resultado antes das mudanças

| Verificação                  | Resultado na base                                            |
| ---------------------------- | ------------------------------------------------------------ |
| TypeScript (`tsc --noEmit`)  | passou                                                       |
| Build Vite de produção       | passou; avisos existentes de bundle e diretivas `use client` |
| Python (`unittest discover`) | 578 testes passaram                                          |
| ESLint                       | falhou com 5.637 erros de Prettier                           |

Dos erros de lint, 5.624 estavam no tipo Supabase gerado
`src/integrations/supabase/types.ts`. Os 13 restantes eram somente formatação em seis arquivos.
O tipo gerado foi excluído do lint; os seis arquivos de código são formatados nesta fase.

## Contrato legado congelado

Os testes unitários registram o comportamento observado nas duas funções duplicadas:

- `decisao_grupo` tem precedência sobre `Decisão final`;
- `CONFIRMA`, `CONFIRMAR` e `CONFIRMA COM CAUTELA` normalizam para `CONFIRMA`;
- `PULAR`, `PASS`, `AGUARDAR NOTÍCIA` e decisão ausente normalizam para `PULAR`;
- `PULAR` retorna stake operacional nula;
- vírgula decimal é aceita;
- ID e pick escolhidos aceitam o formato textual legado e valores `null`;
- a busca de stake começa a partir da decisão encontrada.

Esse parser permanece temporariamente disponível para a migração e rollback controlado das fases
seguintes. Ele não deve ser usado como autorização para contornar o futuro schema e o árbitro
determinístico.

## CI

Pull requests executam instalação congelada por `bun.lock`, lint, typecheck, Vitest, build e testes
Python sem segredos de produção. Os smokes SQL só executam quando a variável
`RUN_SUPABASE_SQL_SMOKE=true` estiver configurada no ambiente protegido `supabase-test`, usando o
segredo `SUPABASE_TEST_DATABASE_URL`.
