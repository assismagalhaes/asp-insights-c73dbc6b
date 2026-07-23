# Fase 1 — Contrato operacional e árbitro determinístico

## Escopo

Esta fase introduz o contrato `1.1.0` para a recomendação da IA e impede que a
resposta bruta do modelo controle decisão, stake ou opção escolhida.

O provider e os prompts atuais continuam em uso. A migração para Structured
Output pertence à Fase 2.

## Fluxo

1. O provider retorna o parecer textual legado.
2. O adaptador de compatibilidade converte os campos operacionais para
   `AiOperationalOutputSchema`.
3. A rota reavalia o objeto contra o estado mais recente das opções do grupo.
4. O árbitro verifica ID, pick, stake, gates vigentes, edge, odd, Preview MLB,
   starters, diagnósticos MatchMatrix e regras PackBall.
5. O parecer exibido e persistido é gerado por `presentation.ts` a partir do
   resultado arbitrado, preservando as seções narrativas A–G.

O texto bruto do provider não é usado em nenhum caminho de aplicação ou
persistência de decisão operacional.

## Apresentação A–G

O adaptador preserva separadamente entrada avaliada, tese favorável, tese
contrária, gates declarados, riscos, histórico interno, justificativa final e
condição de mudança. Os gates narrativos são convertidos em
`APPROVED | REJECTED | UNKNOWN`, mas continuam sendo apenas evidência declarada
pela IA.

A seção G sempre é reconstruída com os campos arbitrados. Quando a recomendação
original é bloqueada, o parecer mostra separadamente a decisão original da IA e
a decisão final validada, sem permitir que o texto bruto controle ID, pick ou
stake.

## Comportamento fail-closed

Qualquer inconsistência transforma a recomendação operacional em:

- `decision: PULAR`;
- `stake: 0`;
- `selected_prediction_id: null`;
- `selected_pick: null`;
- um ou mais códigos de bloqueio explícitos.

Entre os bloqueios cobertos estão schema inválido, ID inexistente, pick
divergente, seleção correlata inconsistente, stake inválida, gate declarado
como reprovado, edge/odd inválidos, starter ou Preview MLB ausente,
diagnóstico MatchMatrix inválido, `SEM_PRECO`, odd executável ausente, edge
PackBall insuficiente e stake acima do cap do modelo.

## Compatibilidade temporária

`legacy-parser.ts` permanece somente como adaptador de entrada durante esta
fase. A decisão extraída por ele não é confiada diretamente: o árbitro sempre
revalida a recomendação antes de ela chegar à interface ou aos snapshots.

Structured Output substituirá essa entrada textual nas PRs da Fase 2. O
contrato e o árbitro permanecerão como fronteira operacional.

## Validação

Os testes unitários cobrem:

- schema e lista de stakes;
- `PULAR` com stake/seleção indevidas;
- ID, pick e grupos correlatos;
- gates declarados pela IA;
- edge efetivo e odd de valor;
- Preview e starters MLB;
- diagnósticos MatchMatrix;
- `SEM_PRECO`, odd, edge e cap PackBall;
- adaptador legado e apresentação derivada do resultado arbitrado.

Esta fase não altera banco, RLS, runners Python, VM, provider ou ambiente de
produção.
