# Fase 4A — Observabilidade e autorização Supabase

## Estado

Implementada no repositório como migration aditiva. A aplicação no projeto
Supabase remoto deve ocorrer antes da publicação do frontend correspondente.

## Telemetria persistida

Cada execução de IA passa a registrar em `analises_ia`:

- `run_id`, versão do schema e versão do árbitro;
- provider, modelo, início, término, latência e finish reason;
- tokens de entrada, saída e total quando fornecidos pelo Gateway;
- status do parser, código seguro de erro e tentativa de reparo;
- decisão válida do modelo e decisão final após o árbitro;
- códigos de bloqueio determinísticos;
- quantidade de buscas, fontes encontradas e páginas efetivamente consultadas.

O texto interno do erro do provider, chaves e credenciais não são persistidos.
Falhas continuam convertidas em `PULAR`, `0u`, sem ID ou pick operacional.

Quando há uma tentativa de reparo, os tokens da primeira geração e do reparo são
somados para refletir o consumo real da execução.

## Segurança

- RLS permanece habilitada em `analises_ia`.
- `anon` não recebe privilégios na tabela.
- `authenticated` recebe privilégios de tabela apenas para que a RLS possa ser
  avaliada.
- políticas separadas de leitura, inserção, atualização e exclusão exigem o papel
  administrativo real por meio de `has_role`.
- `service_role` mantém acesso operacional e nunca é usado no frontend.
- `sync_ai_learning_feedback()` continua como trigger interno; execução direta é
  revogada de `PUBLIC`, `anon` e `authenticated`.

O smoke SQL valida grants, políticas, ACL da função, colunas e round-trip
transacional sem deixar registros.

## Ordem de implantação

1. Aplicar `20260724132820_add_ai_validation_observability.sql` no ambiente de teste.
2. Executar `ai_validation_observability_smoke.sql`.
3. Rodar advisors de segurança e performance.
4. Publicar o frontend.
5. Executar uma análise segura e conferir o snapshot por `run_id`.

## Rollback

A migration é aditiva. Em rollback do frontend, as colunas permanecem sem afetar
os leitores antigos. Remover colunas ou índices exige uma migration posterior e
não faz parte do rollback operacional imediato.
