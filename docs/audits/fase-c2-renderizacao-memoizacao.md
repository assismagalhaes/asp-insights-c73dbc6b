# Fase C2 - Renderizacao, memoizacao e recomputacao

Data: 2026-07-04

## Escopo aplicado

- Mantida a logica de negocio, bankroll, decisoes `CONFIRMAR`/`PULAR`, snapshots, handoffs e dashboards financeiros sem alteracao funcional.
- Nenhuma migration, schema change, troca de biblioteca ou refatoracao estrutural foi criada.
- O foco ficou em handlers, listas derivadas e payloads que eram montados durante renderizacao.

## ASP Screener

- A `queryKey` de standings MLB passou a ser memoizada para manter referencias estaveis.
- Handlers principais de geracao, refresh, shortlist, snapshot, handoff e envio foram estabilizados com `useCallback`.
- O carregamento incremental de oportunidades de snapshot usa callback estavel.
- Payloads JSON de oportunidades, handoffs, calibracao e payload critico passaram a ser renderizados de forma preguiçosa em detalhes expansíveis:
  - o JSON so e serializado quando o `<details>` e aberto;
  - a copia de payload continua montando o mesmo objeto sob acao explicita do usuario.
- Foi adicionado um helper local `LazyJsonDetails` e um bloco memoizado para detalhes de oportunidade, sem mover grandes blocos para novos arquivos.

## ASP Validator

- `loadHistory` foi estabilizado com `useCallback` e usado como dependencia do efeito inicial.
- Handlers de formulario, uploads, abertura de registro, edicao, resultado, exclusao, OCR e IA foram estabilizados nos pontos que descem para listas/dialogs.
- `UploadsDetail` passou a memoizar:
  - uploads de imagem usados para preview;
  - contadores de Storage/OCR/Falhas.
- Pequenos sorts/arrays derivados de UI foram ajustados para evitar recriacao desnecessaria.

## Coleta de Odds

- A tela ja usava `useMemo` para filtros e opcoes.
- Os handlers de pipeline remoto foram mantidos fora do escopo para evitar aumentar o diff com dependencias assíncronas mais sensiveis.

## Decisoes de seguranca

- `JSON.stringify` visivel em paineis de detalhe do Validator foi mantido quando o usuario ja abriu um modal/painel que explicitamente exibe JSON tecnico.
- Sorts feitos sobre arrays novos (`Object.entries`, `Array.from`, spreads) foram considerados seguros por nao mutarem estado/query/props.
- Nenhum calculo de metricas, ROI, yield, banca oficial, stake de `PULAR`, handoff ou snapshot foi alterado.

## QA tecnica

- `tsc --noEmit` passou.
- Testes Python (`unittest discover`) passaram: 365 testes.
- `vite build --outDir .codex_tmp/fase-c2-build --emptyOutDir` passou.
- `eslint .` continua falhando apenas pelo bloco antigo de Prettier/CRLF ja conhecido no projeto.
- O build manteve avisos conhecidos de chunks grandes e `createServerFn().inputValidator()` depreciado.
