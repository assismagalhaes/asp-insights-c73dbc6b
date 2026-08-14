# Fase 2A — Structured Output no modo IA Local

## Escopo

O modo IA Local usa diretamente o Google AI Studio com o provider nativo
`@ai-sdk/google` e o modelo definido por `LOCAL_GATEWAY_MODEL_ID`. O provider
recebe um template JSON estrito e a resposta
é validada pelo `AiOperationalOutputSchema`.

O texto livre não participa mais do caminho operacional padrão. Decisão, stake,
ID, pick, gates e narrativa vêm do objeto validado pelo schema `1.1.0` e seguem
para o árbitro determinístico.

## Fluxo

1. O payload autenticado é validado.
2. O prompt recebe apenas dados internos e contexto manual.
3. `generateText` chama diretamente a API Gemini e exige JSON compatível com o template.
4. A saída é novamente validada por Zod.
5. O árbitro determinístico verifica invariantes, gates e regras operacionais.
6. A apresentação A–G é reconstruída apenas a partir do resultado arbitrado.

Falha de provider, timeout, quota ou schema retorna `parse_status=FAILED`,
`model_output=null` e erro seguro. O árbitro converte esse estado para `PULAR`
com o bloqueio `SCHEMA_INVALID`; uma falha nunca confirma uma entrada.

## Provider

- Secret: `GOOGLE_AI_API_KEY`
- Modelo atual: `gemini-3.6-flash`
- Fallback por modelo indisponível: `gemini-2.5-flash`
- Prompt: `validacao-critica-v16-deterministic-facts`

O modo Local não depende de gateway ou credencial da Lovable.

### Compatibilidade do schema com Gemini

O modo Local solicita exclusivamente JSON em texto, extrai o primeiro objeto
retornado e o valida com o schema de geração simplificado.

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
