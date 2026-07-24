# Fase 5C — Acessibilidade e QA visual

## Objetivo

Fechar a modernização visual da Fase 5 com contratos de acessibilidade,
responsividade e regressão para os componentes compartilhados. Esta fase não
altera banco, IA, cálculos, regras operacionais ou estados de prognósticos.

## Escopo

- atalho para pular diretamente ao conteúdo principal;
- identificação semântica da rota e do status operacional;
- indicação `aria-current` na navegação ativa;
- foco reforçado, alto contraste e suporte a movimento reduzido;
- tabelas roláveis nomeadas e alcançáveis por teclado;
- modais limitados ao viewport, com fechamento acessível e descrições;
- tabs roláveis e campos de texto consistentes em telas estreitas;
- cards de indicadores expostos como regiões nomeadas;
- Storybook configurado para reprovar violações de acessibilidade;
- testes de contrato para skip link, indicadores e tabelas.

## Critérios de aceite

- navegação essencial utilizável por teclado;
- foco visível em controles e regiões roláveis;
- ausência de overflow horizontal na página em 390 px;
- modais legíveis e roláveis sem escapar do viewport;
- histórias críticas sem violações bloqueantes no addon de acessibilidade;
- typecheck, lint, testes, build e Storybook aprovados.

## Rollback

Reverter o commit da Fase 5C restaura os contratos visuais anteriores. Não há
migration nem rollback de dados.
