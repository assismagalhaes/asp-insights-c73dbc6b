# Fase 2A — Structured Output no modo IA Local

## Escopo

O modo IA Local usa a API Google diretamente, com o modelo definido por
`GOOGLE_MODEL_ID`, e solicita um objeto compatível com
`AiOperationalOutputSchema` por meio de `Output.object`.

O texto livre não participa mais do caminho operacional padrão. Decisão, stake,
ID, pick, gates e narrativa vêm do objeto validado pelo schema `1.1.0` e seguem
para o árbitro determinístico.

## Fluxo

1. O payload autenticado é validado.
2. O prompt recebe apenas dados internos e contexto manual.
3. `generateText` chama o provider Google com `Output.object`.
4. A saída é novamente validada por Zod.
5. O árbitro determinístico verifica invariantes, gates e regras operacionais.
6. A apresentação A–G é reconstruída apenas a partir do resultado arbitrado.

Falha de provider, timeout, quota ou schema retorna `parse_status=FAILED`,
`model_output=null` e erro seguro. O árbitro converte esse estado para `PULAR`
com o bloqueio `SCHEMA_INVALID`; uma falha nunca confirma uma entrada.

## Provider

- Secret: `GOOGLE_GENERATIVE_AI_API_KEY`
- Modelo: `GOOGLE_MODEL_ID` em `src/lib/google-ai.server.ts`
- Prompt: `validacao-critica-v13-structured-output-local`

O modo Local não depende de `LOVABLE_API_KEY`.

## Rollback

O parser legado só pode ser ativado explicitamente:

```text
AI_VALIDATION_LOCAL_LEGACY_ROLLBACK=true
```

Nesse modo, a resposta retorna `parse_status=LEGACY_ROLLBACK`. Falha do caminho
estruturado não aciona o parser automaticamente.

Para encerrar o rollback, remova a variável ou defina-a como `false`.

## Critérios de aceite

- schema válido para respostas operacionais;
- zero confirmação em falha de provider ou contrato;
- invariantes do árbitro permanecem vigentes;
- saída A–G preservada;
- `sources` e `searches` vazios no modo Local;
- lint, tipagem, testes, cobertura e build aprovados.
