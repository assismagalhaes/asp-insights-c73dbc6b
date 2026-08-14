# Fase 3 — Avaliações contínuas da IA

## Estado

Implementada para os modos **IA Local** e **IA Online + Pesquisa**, com o modelo
`gemini-3.6-flash` via Google AI Studio e contrato operacional `1.1.0`.

## Política da migração de modelo

A troca do Gemini 2.5 Pro para o Gemini 3.6 Flash prioriza custo-benefício. Diferenças
de redação, gates narrativos e decisão sugerida são métricas informativas e não
reprovam uma release isoladamente. Permanecem obrigatórios:

- contrato estruturado válido nos casos que devem ser válidos;
- falha de provider ou schema convertida em `PULAR`, sem seleção e com `0u`;
- `CONFIRMA` somente com ID, pick, preço, edge, gates e stake operacionalmente válidos;
- ausência de fontes e buscas no modo Local;
- fonte consultada e busca rastreável quando uma confirmação Online exigir contexto atual.

## Dataset

`evals/ai-validation/fixtures.ts` contém 80 casos determinísticos, distribuídos entre:

- MLB e WNBA;
- futebol genérico;
- ASP GoalMatrix, ASP CornerMatrix e ASP BackMatrix;
- modos Local e Online;
- confirmação válida, `PULAR`, JSON inválido, falha de provider, stake indevida,
  pick divergente, gate reprovado e disciplina de fontes.

As fixtures não chamam o provider e não consomem créditos. Elas testam o contrato, o
fail-safe e o árbitro de forma reprodutível no CI.

## Gates de release

O comando abaixo executa a avaliação:

```text
bun run eval:ai
```

Limites atuais:

- no mínimo 80 casos;
- 100% das expectativas determinísticas aprovadas;
- pelo menos 99% de validade entre os casos esperados como válidos;
- 100% de fail-safe para falhas esperadas;
- zero violações operacionais;
- zero traços externos indevidos no modo Local;
- zero confirmações Online sem pesquisa quando a fixture exigir contexto atual.

## Comparação entre modelos

`compareAiModelSnapshots()` aceita snapshots pareados por `case_id` e calcula:

- concordância de decisão e gates;
- validade estrutural e taxa de reparo;
- latência média;
- custo estimado total.

Concordância e qualidade são observadas, mas não são hard gates nesta migração. Custo
e latência devem ser preenchidos com telemetria real do Google AI Studio; as
estimativas anunciadas não são tratadas como comprovadas.

## Canário

O canário de produção deve usar prognósticos pendentes de baseball, sem acionar
`CONFIRMAR`, `PULAR`, publicação ou liquidação. Os registros devem permanecer
`PENDENTE`.

## Rollback

Uma regressão estrutural deve impedir a release. Se uma regressão operacional escapar,
o modelo pode ser revertido pelos constantes `LOCAL_GATEWAY_MODEL_ID` e
`ONLINE_GATEWAY_MODEL_ID`; os rollbacks legados continuam disponíveis pelas flags das
Fases 2A e 2B e sempre passam pelo árbitro determinístico.
