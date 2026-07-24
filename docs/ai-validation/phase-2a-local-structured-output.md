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
3. `generateText` chama o provider Google com `Output.object` e JSON obrigatório.
4. A saída é novamente validada por Zod.
5. O árbitro determinístico verifica invariantes, gates e regras operacionais.
6. A apresentação A–G é reconstruída apenas a partir do resultado arbitrado.

Falha de provider, timeout, quota ou schema retorna `parse_status=FAILED`,
`model_output=null` e erro seguro. O árbitro converte esse estado para `PULAR`
com o bloqueio `SCHEMA_INVALID`; uma falha nunca confirma uma entrada.

## Provider

- Secret: `LOVABLE_API_KEY`
- Modelo: `google/gemini-2.5-pro`
- Prompt: `validacao-critica-v13-structured-output-local`

O modo Local não depende de `GOOGLE_GENERATIVE_AI_API_KEY`.

### Compatibilidade do schema com Gemini

O Lovable AI Gateway não declara suporte confiável a `Output.object`. O modo
Local solicita exclusivamente JSON em texto, extrai o primeiro objeto retornado
e o valida com o schema de geração simplificado.

O objeto retornado continua sendo validado integralmente pelo
`AiOperationalOutputSchema` antes de chegar ao árbitro. Não existe fallback
automático para texto legado.

Antes dessa validação integral, um schema de geração aceita somente omissões
formais seguras (`sources`, `searches`, listas de riscos/limitações e campos
anuláveis), preenchendo defaults locais. Se o JSON nem sequer passar nesse
schema, o sistema permite uma única tentativa de reparo estrutural com o mesmo
Gemini. Uma segunda falha continua fechada em `PULAR`.

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
