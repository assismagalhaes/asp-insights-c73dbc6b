# Início das recomendações operacionais — 2026-09-24

## Estado desta intervenção

- Corrigida a formatação da lista `requiredPublicBuildVariables` em
  `scripts/deploy_cloudflare_staging.mjs`, que fazia o `eslint-plugin-prettier` reprovar o CI.
- Verificações concluídas: Prettier no arquivo alterado, ESLint no repositório inteiro e
  TypeScript typecheck passaram.
- Vitest não iniciou: o sandbox bloqueou o acesso do esbuild ao diretório pai. A suíte Python
  executou 782 casos, mas terminou com quatro erros de importação porque este ambiente não tem
  `fastapi`/`requests`; um caso foi ignorado. O build e a avaliação de IA não foram executados.
- O commit `d78ad07` corrigiu o lint e revelou uma lacuna preexistente no CI: dois módulos Python
  de teste importavam `pytest`, ausente da instalação do job.
- O commit `3dfd9df` adicionou `requirements-test.txt` com `pytest==9.1.1` e configurou o workflow
  para instalar esse arquivo. A dependência de produção da API continua separada.
- A execução CI `36065345874` passou integralmente: lint, typecheck, testes unitários, avaliação
  de IA, build de produção, dry run Cloudflare e suíte Python.
- A inspeção do código confirmou que a janela móvel de partidas futuras já está implementada:
  `scripts/run_highlightly_future_schedule.py` define quatro horários em `America/Sao_Paulo` e
  inclui uma execução noturna de D+1 a D+5. Os units correspondentes estão versionados em
  `config/systemd/`.
- A ativação dos timers da janela futura e do continuador continua pendente de confirmação na VM.
  O runbook condiciona a instalação ao fim do backfill histórico e à publicação do commit em
  `origin/main`; não foi alterado estado remoto nesta intervenção.
- A sessão Jupyter aberta aponta para `asp-insights-publish-20260904`, um snapshot/exportação
  antigo, e não confirmou o caminho operacional `/home/ubuntu/asp-insights-c73dbc6b`. Portanto,
  esse navegador não é evidência suficiente para instalar timers ou editar a VM.
- Nenhuma migration Supabase foi criada ou aplicada. O gate de futebol precisa ser revisto com
  evidência atual do banco antes de se alterar a regra: a função atual diferencia batimento do
  monitor e frescor de odds de partidas prestes a começar, tratando corretamente o caso sem jogos
  nas próximas 24 horas como `not_applicable_no_due_matches`.

## Próximos passos seguros

1. Confirmar o acesso ao checkout operacional da VM e o término do backfill; então comparar e
   instalar os timers versionados de janela futura, continuação e atualização de odds conforme os
   runbooks.
2. Consultar novamente o gate e os registros recentes de coleta no Supabase. Só alterar a lógica
   se a evidência mostrar que respostas vazias estão sendo contadas como cobertura saudável.
3. Depois que a janela D0–D5 e odds estiverem operacionais, validar partidas e mercados reais,
   mantendo provider e publicação de prognósticos sujeitos aos gates existentes.

## Limites desta atualização

Não houve chamada à Highlightly, alteração na VM ou migration. As alterações de código e CI foram
publicadas em `origin/main`; a etapa operacional da VM continua pendente por falta de acesso
confirmado ao checkout correto.
