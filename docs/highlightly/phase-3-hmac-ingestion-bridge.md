# Ponte HMAC de ingestão Highlightly

Data: 15/07/2026

## Objetivo

A VM externa grava e consulta exclusivamente os objetos Highlightly permitidos por meio de
`/api/public/hooks/highlightly-ingest`. A `SUPABASE_SERVICE_ROLE_KEY` permanece no ambiente
server-side da Lovable Cloud e nunca é copiada para a VM.

Cada requisição contém método, caminho, headers operacionais, hash do corpo, timestamp e nonce
assinados com HMAC-SHA256. O endpoint valida uma janela de cinco minutos, compara a assinatura em
tempo constante, aplica allowlists explícitas e registra o nonce atomicamente no banco. Repetições
do mesmo nonce retornam HTTP 409.

## Implantação na Lovable Cloud

1. Aplicar `supabase/migrations/20260715180000_create_highlightly_ingestion_bridge_nonces.sql`.
2. Executar `supabase/tests/highlightly_phase3_bridge_smoke.sql`.
3. Criar um segredo aleatório com pelo menos 32 caracteres.
4. Configurar `HIGHLIGHTLY_INGEST_BRIDGE_SECRET` somente nos secrets server-side da aplicação.
5. Publicar a aplicação e confirmar a URL pública do endpoint.

Uma chamada sem assinatura válida deve retornar HTTP 401. A migration não habilita o provider e
não inicia o worker.

## Configuração protegida da VM pelo Windows PowerShell

Abra o Windows PowerShell e conecte-se:

```powershell
ssh ubuntu@201.23.77.253
```

No shell da VM, edite o arquivo protegido:

```bash
sudo nano /etc/asp-scraper-api.env
```

Adicione somente estas duas linhas, substituindo os placeholders:

```dotenv
HIGHLIGHTLY_INGEST_BRIDGE_URL=https://DOMINIO-PUBLICADO/api/public/hooks/highlightly-ingest
HIGHLIGHTLY_INGEST_BRIDGE_SECRET=SEGREDO-ALEATORIO-COM-32-OU-MAIS-CARACTERES
```

Não adicione `SUPABASE_SERVICE_ROLE_KEY` à VM. Salve com `Ctrl+O`, Enter e saia com `Ctrl+X`.
Confirme permissões e a presença das variáveis sem revelar seus valores:

```bash
sudo chown root:root /etc/asp-scraper-api.env
sudo chmod 600 /etc/asp-scraper-api.env
sudo bash -c 'set -a; . /etc/asp-scraper-api.env; set +a; test -n "$HIGHLIGHTLY_INGEST_BRIDGE_URL" && test ${#HIGHLIGHTLY_INGEST_BRIDGE_SECRET} -ge 32'
```

O último comando deve terminar sem mensagem e `echo $?` deve retornar `0`.

## Shadow MLB limitado

Depois que o commit estiver publicado, atualize o checkout operacional e execute com os secrets
carregados apenas no processo:

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
git pull --ff-only origin main
sudo bash -c 'set -a; . /etc/asp-scraper-api.env; set +a; cd /home/ubuntu/asp-insights-c73dbc6b; PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python -m scripts.run_highlightly_baseball_shadow --date 2026-07-15 --max-jobs 100 --confirm-bounded-shadow'
```

O runner recusa uma fila ocupada ou um provider já habilitado, ativa a Highlightly somente dentro
do shadow e restaura `sports_providers.enabled=false` em `finally`.

## Rotação e revogação

Para revogar a VM, altere `HIGHLIGHTLY_INGEST_BRIDGE_SECRET` na Lovable Cloud. Depois, instale o
novo valor na VM. Não reutilize o segredo antigo e não o registre em Git, logs, tickets ou chat.
