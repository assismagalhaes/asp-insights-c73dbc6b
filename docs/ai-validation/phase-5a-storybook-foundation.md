# Fase 5A — Fundação Storybook e extração visual

## Objetivo

Criar um ambiente isolado para desenvolver e revisar os estados críticos da
validação por IA, sem importar para os componentes de apresentação a execução
do modelo, a arbitragem determinística, a persistência ou qualquer mutação de
prognóstico.

## Escopo entregue

- Storybook 10.5.3 com React 19 e Vite 7.
- Tailwind CSS 4 e os tokens visuais existentes carregados no preview.
- Addons oficiais de documentação e acessibilidade.
- Scripts `storybook` e `build:storybook`.
- Extração do painel “Análise sugerida pela IA” para
  `src/components/ai-validation/ai-analysis-panel.tsx`.
- Stories iniciais para estado vazio, pesquisa online, parecer confirmado e
  recomendação bloqueada pelo árbitro.
- Testes unitários dos adaptadores textuais usados pela apresentação.

## Limites arquiteturais

O componente extraído recebe dados e callbacks. Ele não:

- chama o Lovable AI Gateway;
- escolhe prognóstico, pick ou stake;
- executa o árbitro determinístico;
- acessa Supabase;
- grava feedback ou análise;
- altera o estado operacional do prognóstico.

A rota `validacao.tsx` continua responsável por todas essas operações.

O Storybook usa uma configuração Vite isolada. O wrapper Vite do
Lovable/TanStack não é carregado, evitando inicializar servidor, rotas ou
integrações de produção durante a renderização de stories.

## Validação e aceite

- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run build`
- `bun run build:storybook`
- inspeção visual do Storybook em desktop e viewport móvel
- confirmação de que os botões das stories não produzem efeitos externos

## Rollback

Remover `.storybook/`, os scripts e dependências Storybook, os arquivos
`ai-analysis-panel.*` e recolocar o JSX de apresentação na rota. Nenhuma
migration, flag operacional ou reversão de dados é necessária.
