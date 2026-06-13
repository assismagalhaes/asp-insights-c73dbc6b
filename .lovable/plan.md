## Objetivo

Adicionar busca online opcional à Validação Crítica, com dois botões claros:
- **Analisar com IA (local)** — já existe; usa apenas dados colados, sem internet.
- **Analisar com IA + Pesquisa online** — novo; Gemini pesquisa na web automaticamente conforme o pick.

## Limitação técnica (importante)

O Lovable AI Gateway é OpenAI-compatível e **não expõe** o `google_search` nativo do Gemini. A pesquisa online será implementada via **tool calling**: o próprio Gemini decide quando precisa buscar e chama uma ferramenta `web_search` que roda no servidor usando **Firecrawl**. O resultado é equivalente — Gemini lê páginas reais e cita fontes — sem exigir chave paga adicional.

## O que será implementado

### 1. Conector Firecrawl
- Linkar Firecrawl ao projeto via `standard_connectors--connect` (injeta `FIRECRAWL_API_KEY` no servidor).
- Se o usuário não quiser linkar, o botão "IA + Pesquisa" fica desabilitado com tooltip explicativo.

### 2. Nova server function `analisarValidacaoOnline`
Arquivo: `src/lib/validacao-ia-online.functions.ts`

- Usa `streamText`/`generateText` da AI SDK + provider Lovable Gateway.
- Modelo: `google/gemini-3-flash-preview` (mais barato) com fallback para `google/gemini-2.5-pro` quando o usuário pedir análise profunda (futuro).
- Registra duas tools:
  - `web_search({ query, recency })` → chama Firecrawl `/search` (com `tbs: 'qdr:w'` por padrão) e retorna top 5 resultados (título, url, snippet).
  - `web_scrape({ url })` → chama Firecrawl `/scrape` em formato markdown para aprofundar em uma fonte específica.
- `stopWhen: stepCountIs(50)` (loop de agente).
- System prompt orienta Gemini a buscar **automaticamente conforme o pick**:
  - **Notícias recentes** do jogo/times (últimas 72h).
  - **Status do elenco / lineups / lesões** quando o mercado for sensível a isso (player props, handicap, ML).
  - **Contexto de mercado e jogo** (clima para esportes outdoor, forma recente, polêmicas).
- Retorna estrutura: `{ parecer, decisao_sugerida, stake_sugerida, fontes: [{titulo, url}], buscas_realizadas: [query] }`.

### 3. Tela `validacao.tsx`

Substituir o atual botão único "Analisar com IA" por **dois botões lado a lado**:

```
[ 🧠 IA local ]   [ 🌐 IA + Pesquisa online ]
```

- Cada um aciona sua server function.
- Painel de resultado da IA ganha aba/seção extra **"Fontes consultadas"** com lista clicável de URLs e a lista de buscas feitas pelo modelo.
- Indicador visual `🌐` no parecer da IA quando vier da versão online (para diferenciar no histórico).
- Toast informando "Pesquisando notícias e contexto…" enquanto roda (pode levar 10-30s).
- Tratamento de erros 402/429 do gateway e erros do Firecrawl com mensagens claras.

### 4. Persistência

Estender tabela `validacoes` com:
- `fontes_consultadas` (jsonb nullable) — array `[{titulo, url}]`.
- `buscas_realizadas` (jsonb nullable) — array de queries.
- `modo_ia` (text nullable) — `'local'` ou `'online'`.

Mostrar essas infos no `DadosTecnicosViewer` quando existirem.

### 5. Fluxo de configuração para o usuário

Na primeira vez que clicar em "IA + Pesquisa", se Firecrawl não estiver linkado:
- Modal explicativo: "Para pesquisa online preciso conectar o Firecrawl (grátis para uso moderado)."
- Botão "Conectar Firecrawl" abre o fluxo de conexão.

## O que NÃO muda

- Botão **IA local** continua funcionando exatamente como hoje (sem internet, sem custo de Firecrawl).
- Decisão final continua humana — IA online só sugere.
- Importação, parser de datas, GREEN/RED, dashboard, bankroll, publicação: intactos.
- Estrutura visual e nomenclatura (Dados Técnicos, Parecer da Validação): mantida.

## Custo / observações

- Cada análise online gasta: ~1-3 buscas Firecrawl + ~1-2 scrapes + tokens Gemini Flash (modelo barato).
- Botão separado garante que você só gasta quando realmente quer pesquisa.

## Arquivos afetados

- **Criados**: `src/lib/validacao-ia-online.functions.ts`, `src/lib/firecrawl.server.ts`.
- **Editados**: `src/routes/_authenticated/validacao.tsx`, `src/components/dados-tecnicos-viewer.tsx`, `src/lib/db.ts` (tipos da `Validacao`).
- **Migração**: novos campos em `public.validacoes`.