# Fase 4B — Painel de observabilidade da validação IA

## Objetivo

Transformar a telemetria persistida na Fase 4A em uma visão administrativa
somente leitura, sem criar uma fonte paralela e sem permitir qualquer alteração
de prognósticos pelo painel.

## Métricas

- cobertura da telemetria sobre o histórico consultado;
- validade estrutural entre execuções instrumentadas;
- confirmações declaradas pela IA e bloqueadas pelo árbitro;
- taxa de erro, tentativa de reparo, latência média e p95;
- tokens totais e médios quando informados pelo Gateway;
- divergência entre decisão da IA e decisão humana;
- cobertura e quantidade de fontes no modo online;
- GREEN/RED, acurácia e ROI teórico por modelo, prompt, modo e esporte;
- principais códigos determinísticos de bloqueio;
- falhas recentes com código seguro, sem texto interno do provider.

## Limites e interpretação

- Registros anteriores à Fase 4A não entram no denominador de validade
  estrutural; aparecem apenas na cobertura da telemetria.
- ROI é explicitamente teórico e só é calculado quando há resultado resolvido e
  stake positiva vinculada ao snapshot.
- A Fase 4A mede quantidade de buscas, scrapes e fontes. Atualidade por fonte
  ainda não possui campo estruturado e não é inferida a partir do parecer.
- Consultas são limitadas a 5.000 registros por tabela. O painel avisa quando o
  limite é alcançado e orienta reduzir o período.

## Segurança

- A rota continua protegida pelo gate administrativo global da aplicação.
- O frontend usa a chave publicável e a sessão do usuário; `service_role` não é
  utilizada.
- As consultas selecionam apenas colunas analíticas necessárias.
- A RLS administrativa da Fase 4A permanece a autoridade para
  `analises_ia` e `feedback_ia_resultados`.
- Não há `INSERT`, `UPDATE`, `DELETE`, RPC privilegiada ou nova view.

## Implantação

1. Executar testes unitários, typecheck, lint e build.
2. Publicar o frontend após confirmar que a migration da Fase 4A está aplicada.
3. Abrir `/observabilidade-ia` com uma sessão administrativa.
4. Conferir que registros históricos sem telemetria não reduzem artificialmente
   a taxa de schema válido.
5. Validar filtros e estados vazio, erro e limite sem executar nova análise.

## Rollback

Reverter o frontend para a versão anterior remove a rota e o item de navegação.
Nenhum rollback de banco é necessário.
