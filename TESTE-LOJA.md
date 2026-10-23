# 🧪 Guia de teste — Perfil Comprador e Perfil Editor (admin)

Este guia descreve o roteiro de teste dos dois perfis. Os serviços **não sobem sozinhos** — siga a seção abaixo antes de testar.

## Serviços

| Serviço | Endereço | O que é |
|---|---|---|
| **Site (comprador)** | http://localhost:5500 | Frontend estático (servidor com `no-cache` — F5 sempre pega código novo) |
| **Painel do editor** | http://localhost:3333/admin/admin.html | Servido pela API |
| API | http://localhost:3333/api | Fastify |
| Correios (SIMULADO) | porta 4500 (interno) | Mock local para o frete aparecer no checkout — **não é a API real** |

## Como iniciar tudo do zero

```bash
cd "/home/paulomorais/Área de trabalho/editoranascente"

# 1. Banco (se não estiver rodando)
cd backend && docker compose up -d postgres && cd ..

# 2. Simulador dos Correios (para testar frete; sem ele o checkout mostra "frete a combinar")
setsid nohup node backend/scripts/correios-mock.mjs > backend/correios-mock.log 2>&1 < /dev/null &

# 3. API — precisa das variáveis do mock dos Correios (build antes, se dist/ estiver desatualizado)
cd backend && npm run build
CORREIOS_BASE_URL=http://127.0.0.1:4500 CORREIOS_CLIENT_ID=mock-id CORREIOS_CLIENT_SECRET=mock-secret \
  setsid nohup node dist/server.js > server.log 2>&1 < /dev/null &
cd ..

# 4. Site estático (servidor de dev com Cache-Control: no-cache)
setsid nohup python3 backend/scripts/static-server.py > static-server.log 2>&1 < /dev/null &

# 5. Estoque para o comprador (seed zera; ajuste pelo painel ou direto):
cd backend && docker compose exec -T postgres psql -U nascente -d nascente -c 'UPDATE "Product" SET stock = 5;'
```

Para parar: `pkill -f "dist/server.js"; pkill -f "correios-mock"; pkill -f "static-server.py"` (cuidado: rode de um terminal cujo comando não contenha os próprios padrões).

> **Pagamento real:** o Mercado Pago não está configurado neste ambiente. Ao finalizar, o checkout cria o pedido com sucesso e para na mensagem `PAYMENT_PROVIDER_NOT_CONFIGURED` — é o esperado. Com credenciais de teste no `.env` (`MERCADOPAGO_ACCESS_TOKEN` + `MERCADOPAGO_WEBHOOK_SECRET`), o comprador seria redirecionado ao checkout do MP.

> **Token do editor:** está em `backend/.env`, linha `EDITOR_API_TOKEN`. Ler com:
> `grep EDITOR_API_TOKEN backend/.env`

---

## 👤 Roteiro 1 — Perfil COMPRADOR

1. Abra **http://localhost:5500**
2. No catálogo, **Adicionar +** em 1–2 livros (o carrinho conta no carrinho do topo)
3. Abra o carrinho, ajuste quantidades, **Continuar para finalizar**
4. Preencha o formulário (use CEP `74000-000`):
   - Ao sair do campo CEP, o **frete é cotado**: aparecem SEDEX (R$ 39,00 · 2 dias) e PAC (R$ 19,70 · 9 dias) — selecione um
   - O preço mostrado já inclui o frete no cálculo do servidor (o cliente não escolhe preço)
5. **Ir para o pagamento** → pedido criado ✅ → mensagem `PAYMENT_PROVIDER_NOT_CONFIGURED` (sem MP no ambiente — esperado)
6. **Veja o pedido**: abra **http://localhost:5500/pedido.html** — o pedido está lá via `sessionStorage` (status "Aguardando pagamento", itens, frete, total)
7. *Opcional:* copie o link do formato `pedido.html#pedido=ID&token=TOKEN` (está no console: `JSON.parse(sessionStorage.getItem("nascente-last-order"))`) — é o link que o comprador guarda para acompanhar de qualquer navegador

O que validar: sem estoque o pedido é recusado (`INSUFFICIENT_STOCK`); o preço nunca vem do navegador; o token do pedido fica **apenas** no seu navegador (quem não tem o link não vê o pedido).

## 🧑‍💼 Roteiro 2 — Perfil EDITOR (admin)

1. Abra **http://localhost:3333/admin/admin.html**
2. Cole o `EDITOR_API_TOKEN` e **Carregar**
3. **Pedidos**: veja o pedido do Roteiro 1 — clique **Endereço** (onde despachar), **Contato** (e-mail do comprador, auditado), mude status para `PAID`
4. **Rastreio**: digite um código (ex.: `BR123456789BR`) e clique **Rastreio**
5. **Capa**: em qualquer livro, escolha um arquivo PNG/JPG ou PDF no seletor e clique **Capa** — a capa aparece no catálogo (imagem) e na página do livro (imagem ou PDF renderizado). **Remover capa** desfaz
6. **Novo livro**: preencha "Nova obra" (slug em minúsculas com hífen, ex.: `novo-livro-teste`) e cadastre
7. Abra o catálogo público — o livro novo **já aparece**; abra `http://localhost:5500/livro.html?livro=novo-livro-teste` (página de detalhe gerada)
8. **Desativar** o livro novo → ele some do catálogo (histórico de pedidos permanece)
9. Volte ao **pedido.html do comprador** e clique **Atualizar status** → status `PAID` e rastreio aparecem lá

O que validar: toda ação registra auditoria (`docker compose exec postgres` → tabela de logs, ou `tail` no log da API, eventos `admin_action`); token errado 5× bloqueia o IP por 15 min; cancelar pedido não pago devolve estoque.

## 🛑 Parar tudo

```bash
kill $(cat /tmp/opencode/server.pid) $(cat /tmp/opencode/static.pid) $(cat /tmp/opencode/mock.pid) 2>/dev/null
cd backend && docker compose stop
```
