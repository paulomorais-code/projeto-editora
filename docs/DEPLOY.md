# 🚀 DEPLOY — Nascente em VPS (Docker + Nginx)

Guia do zero: VPS limpo → loja publicada em HTTPS com webhook do Mercado Pago funcionando.
Arquitetura: `docker-compose.prod.yml` sobe **API + Postgres + Nginx**; o site estático é servido
pelo Nginx a partir de `./site` (cópia da raiz do repositório).

## 0. Pré-requisitos

- VPS Ubuntu 22.04+ (1 GB RAM basta) com Docker + Compose: `curl -fsSL https://get.docker.com | sh`
- Domínio apontando (A record) para o IP da VPS
- Conta **vendedora** no Mercado Pago aprovada (produção)

## 1. Código e configuração

```bash
git clone <seu-repo> nascente && cd nascente
mkdir -p nginx/certs nginx/certbot
# o frontend já vive em site/ no repositório
cp backend/.env.production.example backend/.env
nano backend/.env          # preencha TUDO (senhas/segredos com openssl rand -base64 48)
nano nginx/nascente.conf   # troque SEU_IP_AQUI pelo IP/VPN que acessa o painel
```

## 2. TLS (Let's Encrypt, webroot)

```bash
docker compose -f docker-compose.prod.yml up -d nginx   # sobe com o redirect 80→443 comentado? NÃO:
# 1ª vez: comente o bloco "return 301" no nascente.conf, suba, emita, descomente:
docker run --rm -v "$PWD/nginx/certbot:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d seudominio.com.br --email voce@seudominio.com.br --agree-tos --no-eff-email
# copia os certs para nginx/certs/ (fullchain.pem, privkey.pem), descomenta o 301 e:
docker compose -f docker-compose.prod.yml up -d --force-recreate nginx
```

## 3. Subir a pilha

```bash
docker compose -f docker-compose.prod.yml up -d --build
# primeira vez: schema + seed
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec app npx prisma db seed   # 3 livros, estoque 0
curl -s https://seudominio.com.br/api/health   # {"status":"ok"}
```

## 4. Mercado Pago

1. Painel MP → **Suas integrações** → aplicação → credenciais de **produção** → cole o `MERCADOPAGO_ACCESS_TOKEN` no `.env`
2. **Webhooks**: configure a URL `https://seudominio.com.br/api/payments/mercadopago/webhook` + eventos de *payment*, copie a **chave secreta** para `MERCADOPAGO_WEBHOOK_SECRET`
3. `docker compose -f docker-compose.prod.yml up -d --force-recreate app` para aplicar

Teste end-to-end: compre um livro com estoque > 0 e confirme o webhook marca `PAID` (logs: `docker compose -f docker-compose.prod.yml logs -f app`).

## 5. Pós-deploy (checklist)

- [ ] `https://seudominio.com.br` abre a loja com cadeado (TLS A em ssllabs.com)
- [ ] `/admin/` responde **403 fora do seu IP** e 200 dentro dele
- [ ] Compra de teste: pedido criado → pago no MP → webhook marca `PAID` → rastreio aparece em `pedido.html`
- [ ] Backups agendados:
  ```bash
  # crontab -e  (todo dia 03:20)
  20 3 * * * cd /caminho/nascente && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U nascente nascente | gzip > backups/nascente-$(date +\%F).sql.gz
  ```
  E inclua o volume `uploads-data` (capas) na rotina de backup.
- [ ] Renovação do certbot no cron (`certbot renew --webroot` a cada 60 dias)

## 6. Atualizações

```bash
git pull
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d --force-recreate app
docker compose -f docker-compose.prod.yml exec -T app npx prisma migrate deploy
```

## 7. LGPD

Defina `RETENTION_DAYS` (ex.: 365) — o job diário do app anonimiza endereço/e-mail de pedidos
`DELIVERED`/`CANCELLED` mais antigos que isso, preservando o registro financeiro.
