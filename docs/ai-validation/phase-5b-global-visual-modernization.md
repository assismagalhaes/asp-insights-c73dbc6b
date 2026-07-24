# Fase 5B — Modernização visual global

## Objetivo

Aplicar ao ASP Insights uma linguagem visual única, moderna e responsiva, com
densidade adequada a um painel operacional. A fase altera somente apresentação e
composição: regras de negócio, cálculos, persistência, IA, árbitro determinístico
e estados dos prognósticos permanecem inalterados.

## Direção visual

- fundo midnight navy e superfícies elevadas com contraste discreto;
- azul elétrico como ação primária;
- verde, âmbar e vermelho reservados para semântica operacional;
- tipografia sans para leitura e mono/tabular para indicadores;
- bordas compactas e elevação curta, sem gradientes ou efeitos decorativos;
- shell persistente no desktop e navegação adaptada no mobile.

Os conceitos de referência estão em:

- `docs/visual/phase-5b-dashboard-desktop-concept.png`;
- `docs/visual/phase-5b-dashboard-mobile-concept.png`.

## Escopo aplicado

- tokens globais, foco, seleção, scrollbar e superfícies reutilizáveis;
- cabeçalho da aplicação, sidebar recolhível e indicação de seção ativa;
- botões, inputs, selects, badges, cards, tabelas e indicadores;
- cabeçalhos e espaçamento das rotas autenticadas;
- modernização prioritária do Dashboard, Prognósticos e Validação Crítica;
- alinhamento visual de Importação, Coleta, Histórico, Modelos, Base de Dados,
  Publicação, Bankroll, Configurações, Aprendizado e Observabilidade;
- história responsiva dos indicadores no Storybook.

## Critérios de aceite

- build da aplicação e build estático do Storybook sem erros;
- typecheck e testes existentes sem regressão;
- navegação e conteúdo utilizáveis a partir de 320 px;
- foco visível e contraste sem depender apenas de cor;
- nenhuma migration, Edge Function, provider ou regra operacional alterada;
- arquivos não relacionados continuam fora do commit.

## Rollback

Reverter o commit da Fase 5B restaura integralmente o tema e a composição
anteriores. Como não há alteração de banco ou contrato, o rollback não exige
migration reversa nem tratamento de dados.
