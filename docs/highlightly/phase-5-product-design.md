# Fase 5 — especificação de produto da Central Esportiva

Data de aprovação: 15/07/2026  
Status: aprovado para implementação

## Superfícies aprovadas

- `design/phase-5/asp-analysis-center-desktop-v1.png`: explorador diário com grade de partidas e detalhe contextual.
- `design/phase-5/asp-analysis-match-odds-desktop-v1.png`: estado focado de odds e evidências por bookmaker.
- `design/phase-5/asp-analysis-responsive-v1.png`: adaptações de tablet e mobile.

As imagens são especificação visual de produção. A implementação deve preservar hierarquia, densidade, composição, cores e comportamento responsivo; as referências do Packball serviram apenas para entender o fluxo operacional.

## Sistema visual

### Cor

- fundo global: navy profundo já definido por `--background`;
- rail/sidebar: `--sidebar`;
- superfície de análise: variação entre `--background` e `--card`, sem gradiente;
- divisores: `--border`, com espessura de 1 px;
- seleção e navegação ativa: `--primary`;
- preço favorável, placar vencedor e integridade positiva: `--success`;
- lado oposto/queda/preço de Under: `--destructive`;
- qualidade ou integridade bloqueada: `--warning`;
- textos auxiliares: `--muted-foreground`.

Não usar glow, glassmorphism, sombras decorativas ou grades de cards. A organização acontece por rails, linhas, tabelas e divisores.

### Tipografia

- família de interface: Inter;
- valores e horários: JetBrains Mono quando a comparação vertical exigir largura estável;
- título de tela: 18–20 px / 600;
- título de painel: 14–16 px / 600;
- corpo/linha: 12–14 px / 400–500;
- caption/metadado: 10–12 px / 400–500;
- placar: 34–40 px / 700 no desktop e 30–34 px no mobile.

### Geometria e espaçamento

- raio principal: 6–10 px, coerente com o `new-york` existente;
- altura de controles: 36–40 px no desktop, mínimo de 44 px em touch;
- linha de partida: 64–72 px;
- gutters: 12–16 px nos painéis densos; 20–24 px em cabeçalhos;
- sem wrappers arredondados em torno de regiões inteiras.

## Arquitetura de componentes

1. `CentralEsportiva`: composição e sincronização de URL.
2. `AnalysisToolbar`: busca, data, esporte e atualização/freshness.
3. `MatchExplorer`: lista virtualizada e seleção por teclado.
4. `MatchDetail`: cabeçalho, score e abas disponíveis por capacidade.
5. `OddsPanel`: linha/mercado, consenso, movimento e quotes.
6. `StatisticsPanel`: comparação de todas as métricas por grupo.
7. `MatchSummaryPanel`: contexto, períodos, cobertura e alertas de qualidade.
8. `AnalysisEmptyState` e `AnalysisSkeleton`: estados vazio, erro e carregamento.

## Interações obrigatórias

- esporte, data e busca atualizam a lista sem bloquear a digitação;
- a partida selecionada fica em `?match=` e o esporte em `?sport=`;
- seleção por clique, Enter e Espaço;
- a lista renderiza apenas a janela visível;
- detalhe é consultado somente após seleção;
- abas pesadas e gráficos são carregados sob demanda;
- tablet mantém lista e detalhe; mobile apresenta detalhe em tela cheia com retorno à lista;
- preços sempre exibem quantidade de fontes; consenso com 2–7 fontes é válido;
- dados ausentes ou rejeitados nunca são preenchidos artificialmente.

## Acessibilidade

- foco visível em controles e linhas selecionáveis;
- contraste compatível com WCAG AA;
- tabelas com cabeçalhos semânticos;
- logos têm fallback textual;
- gráficos possuem resumo textual e tabela de evidência;
- alertas de qualidade usam ícone e texto, nunca somente cor.

## Restrições de dados e segurança

- o cliente usa somente a publishable key e JWT do usuário autenticado;
- as RPCs continuam admin-gated no banco;
- nenhuma `service_role`, chave Highlightly ou payload bruto chega ao browser;
- a feature flag `VITE_HIGHLIGHTLY_ANALYSIS_ENABLED` permanece desligada no rollout até a Fase 8.
