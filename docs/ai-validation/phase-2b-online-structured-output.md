# Fase 2B — Structured Output online

## Estado

Implementado para o modo **IA Local + Pesquisa**, usando o Lovable AI Gateway com
`google/gemini-2.5-pro` e o contrato operacional `1.1.0`.

## Fluxo

1. O modelo pode executar até 5 buscas e 3 leituras aprofundadas pelo Firecrawl.
2. O parecer final deve ser um objeto JSON compatível com o contrato `1.1.0`.
3. O servidor descarta `sources` e `searches` declarados pelo modelo e os reconstrói
   exclusivamente a partir da telemetria real das ferramentas.
4. URLs são normalizadas e somente protocolos HTTP(S) são aceitos.
5. Resultados de busca e páginas efetivamente consultadas permanecem distintos no
   registro e na interface.
6. Se o primeiro JSON for inválido, há uma única tentativa de reparo sem novas
   pesquisas.
7. Persistindo a falha, o retorno tem `parse_status=FAILED`; o árbitro determinístico
   fecha a recomendação como `PULAR`, sem seleção e com stake `0u`.

## Baseball

O checklist do canário de baseball preserva como itens críticos:

- starter confirmado, handedness, splits, pitch mix e limites;
- uso recente do bullpen e disponibilidade dos braços de leverage;
- lineup confirmado ou provável e matchups L/R;
- vento, temperatura, park factor e estádio;
- riscos de opener, bullpen game, pitch count limitado e lineup alternativo.

O canário de produção deve ser executado em um prognóstico pendente de baseball sem
acionar `CONFIRMAR`, `PULAR` ou qualquer liquidação. O registro deve permanecer
`PENDENTE`.

## Rollback

O caminho legado pode ser reativado temporariamente com:

```text
AI_VALIDATION_ONLINE_LEGACY_ROLLBACK=true
```

O rollback continua submetido ao árbitro determinístico e fica marcado com
`parse_status=LEGACY_ROLLBACK`. A variável deve permanecer ausente ou `false` no
caminho principal.

## Verificação

- testes unitários do parser, telemetria, URLs e checklist de baseball;
- `tsc --noEmit`;
- suíte Vitest completa;
- ESLint dos arquivos alterados;
- build de produção.
