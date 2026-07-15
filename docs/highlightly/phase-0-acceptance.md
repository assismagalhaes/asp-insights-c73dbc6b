# Fase 0 — registro de aceite técnico

Data: 14/07/2026
Status: **fundação concluída; rotação interativa da chave pendente**.

## Entregas concluídas

- OpenAPI 6.13.2 congelado com 1.170.538 bytes.
- SHA-256: `1981d47f1289fe7a0851267728f1e12dce3aa37ad1baa2dae143e26c43719ea6`.
- Manifest imutável criado.
- Registry executável gerado para 64 operações.
- Capability matrix gerada: Football 25, Baseball 20, Basketball 19.
- Toda operação possui prioridade, cadência, SLA, normalizer, destino, paginação e retenção.
- Convenções canônicas de IDs, datas, temporadas, números, unidades, métricas, estados, odds e proveniência definidas.
- Política de retenção e orçamento diário de 7.500 chamadas definidos.
- Feature flag `highlightly_analysis_enabled` desligada por padrão.
- Template de ambiente sem credenciais criado.
- Instalador interativo de secret criado e validado.
- Runbook de segurança, redaction e rotação criado.

## VM

Verificações e alterações seguras realizadas:

- `asp-scraper-api`: ativo após restart.
- environment file real: `/etc/asp-scraper-api.env`.
- permissão corrigida de `0644` para `0600`.
- owner: `root`.
- `HIGHLIGHTLY_BASE_URL`: uma entrada configurada.
- `HIGHLIGHTLY_ANALYSIS_ENABLED=false`: uma entrada configurada.
- instalador em `/home/ubuntu/install_highlightly_vm_secret.sh`.
- instalador: owner `ubuntu`, modo `0700`, `bash -n` aprovado.

Nenhuma chave foi lida, exibida ou escrita durante essa preparação.

## QA

- 15 testes unitários aprovados.
- Contrato e manifest reconciliados por hash.
- Contagem de endpoints reconciliada com o OpenAPI.
- Orçamento de quota soma exatamente 7.500 e reserva 10%.
- Registry regenerado duas vezes com hashes idênticos.
- TypeScript `tsc --noEmit`: aprovado.
- `git diff --check`: aprovado.
- Nenhuma atribuição real de `HIGHLIGHTLY_API_KEY` encontrada no repositório.

## Ação operacional pendente

A chave anteriormente compartilhada não deve ser instalada. Após regenerá-la no painel Highlightly, abrir uma sessão SSH na VM e executar:

```bash
/home/ubuntu/install_highlightly_vm_secret.sh
```

O script:

- solicita a chave de forma invisível;
- não a coloca no histórico;
- atualiza o arquivo com modo `0600`;
- mantém `HIGHLIGHTLY_ANALYSIS_ENABLED=false`;
- reinicia o serviço;
- confirma que o serviço voltou ao estado ativo.

Depois disso, a Fase 0 pode receber status final `complete` e a Fase 1 pode iniciar migrations e fundação de dados.

## Arquivos principais

- `docs/vendor/highlightly/openapi-6.13.2.json`
- `docs/vendor/highlightly/manifest.json`
- `config/highlightly/endpoint-registry.json`
- `docs/highlightly/phase-0-capability-matrix.md`
- `docs/highlightly/phase-0-canonical-contract.md`
- `docs/highlightly/phase-0-security-retention-runbook.md`
- `src/lib/feature-flags.ts`
- `api/highlightly.env.example`
- `scripts/generate_highlightly_endpoint_registry.py`
- `scripts/install_highlightly_vm_secret.sh`
- `tests/test_highlightly_phase0_contract.py`
