# Análise de Segurança e Boas Práticas — Nascente

> **Data:** 2026-10-21 · **Escopo:** repositório completo (frontend estático + backend Fastify/Prisma) · **Método:** revisão manual de código-fonte + `npm audit` + análise de arquitetura
> **Companheiro de:** [`AGENTS.md`](./AGENTS.md) (regras para quem desenvolve aqui)

---

## 1. Resumo executivo

O projeto tem uma **base de segurança acima da média** para o estágio em que está: validação de ambiente com Zod, autenticação admin com comparação `timingSafeEqual`, webhook de pagamento com verificação HMAC e reconsulta ao provedor, estoque reservado em transação, e-mail do comprador armazenado apenas como hash, redação de PII nos logs e fail-closed nas integrações.

Os riscos reais concentram-se em **cinco frentes**:

1. **Vulnerabilidades em dependências** (2 críticas, 3 altas, 1 moderada — todas em cadeia de dev: `vitest`/`tinypool` e `prisma`/`deepmerge-ts`), com majors pendentes (Prisma 7, SDK Mercado Pago).
2. **XSS armazenado** via `innerHTML` com dados vindos da API no frontend e no painel admin.
3. **Painel admin exposto publicamente** com token único estático e sem rate limit dedicado (força-bruta viável a 100 tentativas/min).
4. **Lógica de pedidos abusa do estoque**: `POST /orders` sem limite dedicado, pedido não pago nunca devolve estoque (sem TTL/expiração).
5. **Lacunas operacionais de produção**: sem `trustProxy` (rate limit por IP quebra atrás de proxy), sem CSP/HSTS explícitos, resposta dos Correios sem validação, endereço de entrega armazenado mas sem endpoint de fulfillment.

**Nenhum achado bloqueia desenvolvimento local; 3 bloqueiam ida a produção** (F-01, F-02, F-03).

### Tabela de achados

> **✅ STATUS (2026-10-21):** F-01 a F-18 e F-20 **corrigidos** (ver §1.2). F-19 parcialmente (testes novos implementados; CI ainda pendente). Detalhes das correções na seção 1.2 abaixo e nos commits/código.

| ID | Severidade | Título | Local |
|---|---|---|---|
| F-01 | 🔴 Alta | Dependências vulneráveis (tinypool RCE crítico, deepmerge-ts, vitest mocker) + majors pendentes | `backend/package.json` |
| F-02 | 🔴 Alta | Painel `/admin/` público, token único estático, sem rate limit dedicado (força-bruta) | `src/app.ts`, `src/lib/admin-auth.ts` |
| F-03 | 🔴 Alta | Token admin previsível em `.env` local (`teste-editor-nascente-123...`) — risco se replicado em produção | `backend/.env` |
| F-04 | 🟠 Média | XSS via `innerHTML` com dados da API (título/categoria) no storefront e no painel | `assets/js/cart.js:53,104`, `backend/src/modules/admin/admin.js:8-9`, `assets/js/book-page.js:53` |
| F-05 | 🟠 Média | Esgotamento de estoque: sem rate limit em `POST /orders`, sem expiração de pedido não pago | `src/modules/orders/` |
| F-06 | 🟠 Média | Pedido acessível só pelo ID (`GET /orders/:id`, payment-preference) — ID vaza em logs/referers | `order.routes.ts:20-41` |
| F-07 | 🟠 Média | Sem `trustProxy`: atrás de proxy, rate limit por IP agrada todos num bucket só | `src/app.ts:15` |
| F-08 | 🟠 Média | Sem CSP/HSTS explícitos (helmet em default); admin sem CSP próprio | `src/app.ts:17` |
| F-09 | 🟠 Média | Resposta dos Correios usada sem validação (`as { options: unknown[] }`) | `shipping.service.ts:16` |
| F-10 | 🟠 Média | Endereço de entrega salvo mas inacessível — não há como o editor cumprir o pedido (funcional + decisão LGPD pendente) | `order.service.ts:33`, `admin.routes.ts:47` |
| F-11 | 🟠 Média | Webhook pode regredir `paymentStatus` (evento `pending` tardio sobrescreve `APPROVED`) | `payment.routes.ts:47` |
| F-12 | 🟡 Baixa | `fastifyStatic` com `process.cwd()` — quebra conforme diretório de execução; serve `src/` em produção | `src/app.ts:21` |
| F-13 | 🟡 Baixa | `JSON.parse(localStorage)` sem try/catch corrompido derruba todo o script do carrinho | `assets/js/cart.js:10`, `book-page.js:61` |
| F-14 | 🟡 Baixa | Redirecionamento para `checkoutUrl` sem validação de domínio (open redirect se API comprometida) | `assets/js/checkout.js:30` |
| F-15 | 🟡 Baixa | Erros de negócio por string-matching (`error.message === "..."`) — frágil | `order.routes.ts`, `admin.routes.ts` |
| F-16 | 🟡 Baixa | `docker-compose` publica 5432 em todas as interfaces com senha padrão | `backend/docker-compose.yml:9` |
| F-17 | 🟡 Baixa | `package-lock.json` órfão na raiz (sem `package.json`) | raiz |
| F-18 | 🟡 Baixa | `dataId` do webhook sem validação numérica antes de ir ao SDK | `payment.routes.ts:24-26` |
| F-19 | 🟡 Baixa | Sem lint/formatter/CI; testes só de schemas (nada de rotas/transação/webhook) | repo |
| F-20 | 🟡 Baixa | Preço lido fora da transação de criação do pedido (TOCTOU leve entre leitura e `create`) | `order.service.ts:9-19` |

### 1.2 Status das correções (implementadas e verificadas em 2026-10-21)

Verificação: `npm test` 14/14 · `npm run build` OK · `npm audit` **0 vulnerabilidades** · smoke test end-to-end contra o servidor compilado (dist) com PostgreSQL 16 em Docker.

| ID | Status | Como foi corrigido |
|---|---|---|
| F-01 | ✅ | `vitest@5` (elimina tinypool crítico) e `prisma@7` + `@prisma/client@7` + `@prisma/adapter-pg` (elimina deepmerge-ts), com migração completa: `prisma.config.ts`, generator `prisma-client`, adapter no client/seed, `prisma/migrations/initial` criada. `npm audit` = 0. SDK `mercadopago` não tem CVE aberta; major fica para validação de funcionalidade |
| F-02 | ✅ (app) | Guard anti-força-bruta em `admin-auth.ts` (5 falhas ⇒ bloqueio 15 min por IP, resposta 429 com `retry-after`) + log de auditoria em toda mutação admin + `index: false` no static + CSP `frame-ancestors 'none'`. **Resta operacional:** restringir `/admin/` no proxy reverso (IP allowlist) — ver §6 |
| F-03 | ✅ | Novo `EDITOR_API_TOKEN` gerado com `openssl rand -base64 48` no `.env` local (nunca versionado) |
| F-04 | ✅ | `assets/js/dom.js` com `escapeHtml()` aplicado em `cart.js`, `book-page.js` e `admin.js`; `encodeURIComponent` em slug de links; meta CSP `script-src 'self'` em `index.html`/`livro.html`; `setHtml` do i18n restrito (documentado) a strings estáticas do dicionário |
| F-05 | ✅ | Rate limit dedicado em `POST /orders` e `payment-preference` (10/min/IP) + job `order-expiry.ts`: pedidos `PENDING` não pagos após `ORDER_TTL_HOURS` (padrão 24h) são cancelados e o estoque devolvido em transação, com guard de corrida contra o webhook |
| F-06 | ✅ | Token HMAC-SHA256 stateless por pedido (`signOrderId`/`verifyOrderToken`): `GET /orders/:id` e `payment-preference` exigem `x-order-token` (ou `?token=`); token entregue 1× na criação, propagado nas `back_urls`; verificação `timingSafeEqual` |
| F-07 | ✅ | `trustProxy` configurável via `TRUST_PROXY=true` (env); doc: ligar só atrás de proxy |
| F-08 | ✅ | Helmet com CSP estrita (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS em produção, `X-Frame-Options` |
| F-09 | ✅ | Resposta dos Correios validada com Zod (`quoteResponseSchema`); payload inválido ⇒ 502 |
| F-10 | ✅ | `GET /api/admin/orders/:id/address` (dentro de `requireAdmin`) retorna o endereço para fulfillment, com log de auditoria `order.address_read` |
| F-11 | ✅ | `nextPaymentStatus()` monotônico: nunca regride para `PENDING`; `REFUNDED` terminal; pedido `CANCELLED` não volta a `PAID` (valor fica registrado para reembolso) |
| F-12 | ✅ | `resolveAdminRoot()` via `import.meta.url` + `scripts/copy-admin.mjs` no build (assets em `dist/modules/admin`) |
| F-13 | ✅ | `try/catch` + reset do localStorage corrompido em `cart.js` e `book-page.js` |
| F-14 | ✅ | `isMercadoPagoCheckoutUrl()` valida domínio antes do redirecionamento |
| F-15 | ✅ | `AppError(code, status)` em `src/lib/errors.ts` + handler global; erros 4xx do framework preservam status; migrados todos os módulos |
| F-16 | ✅ | `127.0.0.1:5433:5432` (loopback + porta 5433 para não conflitar com PostgreSQL nativo da máquina) |
| F-17 | ✅ | `package-lock.json` órfão removido da raiz |
| F-18 | ✅ | `dataId` validado com `/^\d{1,20}$/` antes do SDK |
| F-19 | ◐ Parcial | Testes novos: token de pedido (assinatura/falsificação), transição de status, guarda de força-bruta admin. **Pendente:** CI (workflow sugerido no §4), ESLint/Prettier, testes de rota com `app.inject()` |
| F-20 | ✅ | Leitura de produtos, verificação de estoque, baixa e criação do pedido dentro da mesma `$transaction` |

**Bônus corrigido durante a verificação:** variáveis de ambiente opcionais vazias (ex.: `ADMIN_API_TOKEN=` em `.env`) agora são tratadas como "não definidas" (`emptyToUndefined` em `env.ts`) — antes quebravam o boot com ZodError.

### O que já está correto (manter)

- ✅ Validação de env com Zod obrigatória (`env.ts`) — app não sobe mal configurado.
- ✅ `requireAdmin` com `timingSafeEqual` (sem timing attack).
- ✅ Webhook: HMAC `v1/ts` + `request-id` no formato do Mercado Pago, reconsulta do pagamento na API oficial, idempotência por constraint única `(provider, providerEventId)`, hash do payload em vez do payload.
- ✅ Total do pedido recalculado no servidor; preço do item copiado para `OrderItem` (histórico imutável).
- ✅ Estoque: `updateMany` condicional + `decrement` dentro de `$transaction` (sem oversell, sem lock explícito).
- ✅ E-mail só como hash SHA-256 normalizado; redação de `authorization`/`cookie`/`*.email`/`*.shippingAddress` no logger.
- ✅ Erro 500 genérico ao cliente (sem stack leak); CORS de origem única; helmet; rate limit global.
- ✅ Falha fechada (`503`) quando provedor não configurado; `AbortController` com timeout de 5 s nos Correios.
- ✅ Nenhum dado de cartão no site; checkout redireciona ao Mercado Pago.
- ✅ `.gitignore` cobre `.env`; `.env.example` sem segredos reais.

---

## 2. Achados detalhados

### F-01 (Alta) — Dependências vulneráveis

`npm audit` atual: **2 críticas, 3 altas, 1 moderada** — todas em cadeias de desenvolvimento (não chegam ao runtime de produção), mas o README já alerta corretamente:

| Pacote | Severidade | Problema | Correção |
|---|---|---|---|
| `tinypool` (via `vitest`) | 🔴 Crítica | Prototype pollution → RCE (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) | `vitest@^5` |
| `deepmerge-ts` (via `@prisma/config` → `prisma` CLI) | 🔴 Alta | Stack exhaustion em grafos recursivos (GHSA-ggr8-5vv4-36mx) | `prisma@^7` |
| `@vitest/mocker` | 🟠 Moderada | Path traversal / injeção de código em mocks (GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8) | `vitest@^5` |
| `mercadopago` SDK + `@prisma/client` | ⚪ Info | Atualizações majoritárias com fixes disponíveis, exigem validação | ver Plano P2 |

**Impacto:** dev-only hoje; mas `prisma` CLI roda em pipelines de deploy e o README proíbe produção antes da revisão.

### F-02 (Alta) — Superfície de ataque do painel admin

- `fastifyStatic` serve `/admin/admin.html` **para qualquer pessoa na internet** quando a API é publicada.
- Autenticação é um **token estático único** (`EDITOR_API_TOKEN`), enviado por header em cada request, sem expiração, sem rotação, sem contas.
- Rate limit é **global (100/min por IP)** — um atacante testa ~144 mil senhas/dia contra `x-admin-token` sem bloqueio dedicado.
- O `GET /admin` redireciona para o HTML, facilitando descoberta.

**Impacto:** comprometimento do token = criar produtos, alterar preços (não de pedidos existentes, que é um ponto positivo), ver todos os pedidos. Sem HTTPS + proteção de borda, o token também viaja em texto claro.

### F-03 (Alta) — Token admin previsível

`backend/.env` continha `EDITOR_API_TOKEN=teste-editor-nascente-123…` (valor completo omitido desta análise pública) — string digitada por humano. O `.env` está ignorado pelo git (bom), mas:

1. Padrões assim **vazam** (prints, backups, cópia de `.env` entre ambientes).
2. Se este arquivo for copiado para produção, o painel está comprometido.

**Regra:** token de admin só por CSPRNG (`openssl rand -base64 48`) e rotacionado a cada deploy de credencial.

### F-04 (Média) — XSS via `innerHTML`

Dados controlados pelo admin (título, categoria, descrição) são renderizados com `innerHTML` sem escape:

- `assets/js/cart.js:53` (grade do catálogo), `:104` (itens do carrinho) — inclui `localStorage` envenenável;
- `backend/src/modules/admin/admin.js:8-9` — tabela admin (title/slug);
- `assets/js/book-page.js:53` — capa do livro;
- `assets/js/i18n.js:127,173` — `setHtml` (hoje só com strings confiáveis do dicionário, mas é uma porta aberta).

**Cenário:** editor comprometido (F-02) ou slug/título malicioso → XSS persistente na loja contra **compradores** (roubo de carrinho, phishing, scripts de pagamento falsos). O slug é validado por regex no backend; título/categoria/descrição aceitam qualquer texto até 5 000 chars.

**Impacto:** com `httpOnly` ausente e sem cookies de sessão, o dano direto é moderado, mas XSS persistente na página de pagamento é o clássico vetor de troca de checkout.

### F-05 (Média) — Esgotamento de estoque e pedidos fantasma

- `POST /orders` usa só o rate limit global. Cada pedido reserva até 20×20 unidades **permanentemente** até alguém cancelar manualmente.
- Não há job de expiração: pedido `PENDING` nunca pago **nunca devolve estoque** nem muda de estado.
- Resultado: atacante com ~30 requests esvazia o catálogo; a loja para de vender sem nenhum alarme.

### F-06 (Média) — Acesso a pedido apenas por ID

`GET /api/orders/:id` e `POST /api/orders/:id/payment-preference` autenticam apenas posse do `cuid`. CUID é adivinhável na prática? Não por brute force, mas **vaza**: URLs de retorno do Mercado Pago, histórico do navegador, referers, logs de proxy. O payload retornado é bem escolhido (sem endereço/e-mail — bom), porém expõe status de compra de terceiros e permite gerar links de pagamento alheios.

### F-07 (Média) — `trustProxy` ausente

Fastify padrão `trustProxy: false`. Atrás de Nginx/Cloudflare, `request.ip` = IP do proxy ⇒ **todos os clientes compartilham o mesmo bucket de rate limit** (um estouro derruba o site inteiro) e logs de IP ficam inúteis para investigação.

### F-08 (Média) — Headers de segurança incompletos

`app.register(helmet)` usa defaults. Faltam: CSP (protegeria F-04 em profundidade), HSTS (atrás de TLS), e um CSP dedicado à página admin. `@fastify/helmet` aceita configuração por rota.

### F-09 (Média) — Resposta externa sem validação

`shipping.service.ts:16`: `...(await response.json() as { options: unknown[] })` — dados de provedor externo entram na resposta da API sem validação. Qualquer mudança/comprometimento do provedor injeta estrutura arbitrária na resposta JSON da sua API.

### F-10 (Média) — Fulfillment impossível (funcional)

O endereço de entrega é validado, cobrado no fluxo e **armazenado** em `Order.shippingAddress`, mas **nenhum endpoint o retorna** — nem admin, nem o próprio comprador. O editor não consegue despachar o livro. Corrigir exige uma decisão LGPD consciente (quem vê o endereço, com qual base legal, com qual auditoria).

### F-11 (Média) — Regressão de status no webhook

`payment.routes.ts:47`: um evento `pending` **tardio** (reenvio do MP após aprovação) sobrescreve `paymentStatus: APPROVED → PENDING` (`status` fica `undefined` e não regride, mas o pagamento regrede). Corrigir com transição monotônica ou guard de estado.

### F-12 a F-20 (Baixas) — Síntese

- **F-12** `process.cwd()` no `fastifyStatic`: rodar `node dist/server.js` de outro diretório quebra o painel; e produção precisa da árvore `src/` só para servir 2 arquivos.
- **F-13** `localStorage` corrompido lança exceção na linha 10 de `cart.js` e mata **todo** o script (carrinho, modal, checkout).
- **F-14** `checkout.js` navega para `checkoutUrl` sem conferir prefixo de domínio do Mercado Pago.
- **F-15** `error.message === "INSUFFICIENT_STOCK"`: refatorar mensagem quebra rotas silenciosamente. Usar classe de erro com código tipado.
- **F-16** `docker-compose.yml` publica `5432:5432` (todas as interfaces) com senha `nascente` — ok em dev, péssimo hábito.
- **F-17** `package-lock.json` vazio na raiz sem `package.json` — lixo de `npm install` acidental.
- **F-18** `data.id` do webhook vai ao SDK sem `/^\d+$/` — endurecimento barato.
- **F-19** Sem ESLint/Prettier/CI; testes cobrem 2 schemas, não cobrem transação de estoque, webhook, auth admin.
- **F-20** Preço lido fora da `$transaction` de criação — mudança de preço entre leitura e create usa preço misto. Risco baixo (preço do item é fixado no create), documentar ou mover a leitura para dentro da transação.

---

## 3. Pré-requisitos

### 3.1 Para desenvolver (já satisfeito na máquina atual, salvo observações)

| Requisito | Versão | Observação |
|---|---|---|
| Node.js | ≥ 20 (recomendado 22 LTS) | Fastify 5 e Prisma 6 exigem ≥ 18.18; `tsx` e `fetch` nativo pedem 20+ |
| npm | ≥ 10 | |
| Docker + Compose | qualquer recente | só para o PostgreSQL local |
| PostgreSQL | 16 | via `docker-compose.yml` |
| Acesso ao repo com `.env` local | — | `cp .env.example .env` |

### 3.2 Para colocar em produção (bloqueadores listados)

- **Conta Mercado Pago** aprovada (vendedora) + credenciais de produção: `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET` (chave secreta de webhook do painel MP).
- **Contrato Correios** (API de preços/prazos) se quiser frete real: `CORREIOS_BASE_URL/CLIENT_ID/CLIENT_SECRET/CONTRACT_NUMBER`. Sem isso a rota de frete falha fechado com 503 (aceitável).
- **Domínio com HTTPS** (Nginx/Caddy/Cloudflare) — obrigatório antes de expor `/admin`.
- **Segredos gerados por CSPRNG** no cofre/gerenciador (nunca digitados):
  ```bash
  openssl rand -base64 48   # EDITOR_API_TOKEN
  ```
- **Variáveis de ambiente obrigatórias em produção:** `NODE_ENV=production`, `DATABASE_URL`, `FRONTEND_ORIGIN` (URL pública do site), `MERCADOPAGO_*`, `EDITOR_API_TOKEN`. `HOST` pode continuar `127.0.0.1` se atrás de proxy.
- **LGPD:** definir política de retenção/exclusão de pedidos (endereço + hash de e-mail) e quem acessa o painel — pré-requisito para a correção do F-10.

### 3.3 Migração de dependências — ✅ CONCLUÍDA (2026-10-21)

Executada e validada: `prisma`/`@prisma/client` **7.10.1** (com `@prisma/adapter-pg`), `vitest` **5.x**. `npm audit` final: **0 vulnerabilidades**. Mudanças estruturais aplicadas:

- `prisma.config.ts` na raiz do backend (URL do CLI, migrations, seed);
- `schema.prisma`: generator `prisma-client` com `output = "../src/generated/prisma"`; datasource sem `url`;
- Client instanciado com driver adapter (`PrismaPg` + `DATABASE_URL` validado) em `src/lib/prisma.ts` e `prisma/seed.ts`;
- Pasta `src/generated/` gerada pelo `prisma generate` (ignorada no git; rode antes de build/test);
- `prisma migrate dev` **não** roda generate/seed automaticamente em v7 — rodar `npx prisma generate` e `npm run db:seed` explicitamente;
- `vitest.config.ts` restringe testes a `src/**` (evita coletar `dist/`).

SDK `mercadopago` (sem CVE aberta) fica para atualização de funcionalidade, com validação de `Preference.create`/`Payment.get` na major nova.

---

## 4. Como implementar — plano em 4 fases

Ordem pensada para **valor de risco por esforço**. Cada fase é independente e verificável.

### Fase 0 — Saneamento imediato (30 min, sem risco)

1. **Gerar token admin forte** e substituir no `.env` local:
   ```bash
   openssl rand -base64 48
   ```
2. Remover `package-lock.json` órfão da raiz (F-17).
3. Apagar `backend/dist/` do diretório de trabalho (artefato velho; será regenerado).
4. `docker-compose.yml` — restringir a porta ao loopback (F-16):
   ```yaml
   ports:
     - "127.0.0.1:5432:5432"
   ```

### Fase 1 — Correções rápidas de código (meio dia, sem quebra de contrato)

**F-07 — `trustProxy`** (`src/app.ts`):
```ts
const app = Fastify({
  logger: { level: env.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie", "*.email", "*.shippingAddress"] },
  trustProxy: env.NODE_ENV === "production"
});
```
(adicionar `TRUST_PROXY` como env opcional booleana em `env.ts` se quiser controle fino)

**F-05 (parte 1) — rate limit dedicado por rota:**
```ts
// em admin.routes.ts e order.routes.ts
import rateLimit from "@fastify/rate-limit";

app.post("/orders", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => { ... });
// admin: max 10/min (o token errado custa caro)
```

**F-18 — validar `dataId`** antes do SDK (`payment.routes.ts`):
```ts
if (!/^\d{1,20}$/.test(dataId)) return reply.code(400).send({ error: "INVALID_WEBHOOK" });
```

**F-11 — transição monotônica de pagamento** (`payment.routes.ts`, dentro da transação):
```ts
const current = await tx.order.findUnique({ where: { id: orderId }, select: { paymentStatus: true } });
const rank = { PENDING: 0, APPROVED: 1, REJECTED: 1, REFUNDED: 2 } as const;
const next = approved ? "APPROVED" : rejected ? "REJECTED" : "PENDING";
if (!current || rank[next] >= rank[current.paymentStatus]) {
  await tx.order.update({ where: { id: orderId }, data: { paymentProviderId: providerEventId, paymentStatus: next, status: approved ? "PAID" : undefined } });
}
```

**F-09 — validar resposta dos Correios** com Zod (schema `quoteResponseSchema`) em vez de `as`.

**F-13 — leitura resiliente do localStorage:**
```js
let savedCart = {};
try { savedCart = JSON.parse(localStorage.getItem("nascente-cart") || "{}"); } catch { localStorage.removeItem("nascente-cart"); }
```
(repetir em `book-page.js:61`)

**F-14 — validar destino do checkout:**
```js
if (!/^https:\/\/(www\.)?mercadopago\.(com|com\.br)\//.test(paymentResult.checkoutUrl)) throw new Error("Pagamento indisponível.");
window.location.href = paymentResult.checkoutUrl;
```

**F-08 — headers explícitos:**
```ts
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["https://fonts.gstatic.com"],
      frameSrc: ["https://www.mercadopago.com.br"], // checkout redireciona, mas manter defensivo
      connectSrc: ["'self'", env.FRONTEND_ORIGIN]
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true } // só tem efeito atrás de TLS
});
```

### Fase 2 — XSS e estrutura do frontend (1–2 dias)

**F-04 — eliminar `innerHTML` com dado dinâmico.** Criar `assets/js/dom.js`:
```js
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
export function renderList(container, items, buildRow) {
  container.replaceChildren(...items.map(buildRow)); // buildRow cria elementos com textContent
}
```
Aplicar em `cart.js` (renderCatalog/renderCart), `admin.js` (tabelas) e `book-page.js`. **Regra simples:** título/categoria/descrição ⇒ `textContent` ou `escapeHtml()`; atributos dinâmicos (`data-*`) ⇒ `dataset`/`createElement`, nunca concatenação de string.

**F-13 (complemento) / catálogo:** usar `<template>` ou `replaceChildren` nas tabelas admin.

**Frontend em geral:** adicionar `defer` aos `<script>` e isolar `cart.js`/`checkout.js` em módulos (`type="module"`) para habilitar escopo e a exportação acima.

### Fase 3 — Backend estrutural (3–5 dias)

**F-02/F-03 — blindar o painel (em ordem de esforço):**
1. Rate limit dedicado em `/api/admin/*` (Fase 1) + log de auditoria por mutação:
   ```ts
   request.log.info({ event: "admin_action", action: "product.price", productId: id }, "admin mutation");
   ```
2. Mover a proteção de borda para o proxy: no Nginx, `location /admin/ { allow <IP_DO_EDITOR>; deny all; }` ou Basic Auth extra na frente. A página em si não é secreta; o objetivo é tirá-la do alcance de scanners.
3. (Opcional, recomendação de médio prazo) trocar token estático por login com sessão (`@fastify/session` + cookie `httpOnly`, `sameSite: strict`) — único caminho para revogação individual e expiração.

**F-05 (parte 2) — ciclo de vida do pedido** (implementação escolhida: **TTL por `createdAt`**, sem coluna adicional):
- Não há `expiresAt` no schema — o cálculo usa `createdAt + ORDER_TTL_HOURS` (padrão 24 h, configurável);
- Job em `src/lib/order-expiry.ts`, rodando a cada 15 min no processo da API:
  ```ts
  const expired = await prisma.order.findMany({ where: { status: "PENDING", paymentStatus: "PENDING", createdAt: { lt: cutoff } } });
  // cancelamento + reposição via cancelAndRestock (compartilhado com o cancelamento manual)
  ```
- Não reutilizar pedido cancelado para pagamento (o guard `paymentStatus !== "PENDING"` já bloqueia).

**F-06 — segredo de acesso por pedido:**
- Migration: `accessToken String @unique @default(cuid())` (ou bytes aleatórios base64url) em `Order`;
- `createOrder` devolve `{ order, accessToken }`; frontend guarda na `sessionStorage` e envia em `?token=` ou header para `GET /orders/:id` e `payment-preference`; Mercado Pago recebe o token em `back_urls`.
- Validação: `z.string().min(20)`; comparação por lookup indexado (não precisa timing-safe — token é alto-entropia).

**F-10 — fulfillment consciente (LGPD):**
- Novo endpoint `GET /api/admin/orders/:id/address` **dentro de `adminRoutes`**, retornando apenas o endereço do pedido, com log de auditoria (`admin_action`, `orderId`);
- Documentar no README a base legal (execução de contrato) e o tempo de retenção; prever endpoint de exclusão/anonimização para o direito de eliminação.

**F-15 — erros tipados:**
```ts
// src/lib/errors.ts
export class AppError extends Error { constructor(public code: string, public status: number) { super(code); } }
// service: throw new AppError("INSUFFICIENT_STOCK", 409)
// routes/app: catch (error) { if (error instanceof AppError) return reply.code(error.status).send({ error: error.code }); }
```
Migrar módulo a módulo; manter compatibilidade dos códigos existentes.

**F-12 — caminho estático robusto:**
```ts
import { fileURLToPath } from "node:url";
const adminDir = join(dirname(fileURLToPath(import.meta.url)), "../../modules/admin");
```
(ou copiar `admin.html/admin.js` para `dist/admin` no build e servir de lá)

**F-19 — testes que faltam (mínimo viável):**
- Transação de estoque: 2 pedidos concorrentes pelo último item ⇒ 1 sucesso, 1 `INSUFFICIENT_STOCK`;
- Webhook: assinatura válida/inválida, evento duplicado (idempotência), evento `pending` tardio (não regredir);
- `requireAdmin`: token ausente/errado/correto;
- Testes de rota com `app.inject()` do Fastify (sem rede).

### Fase 4 — Dependências e CI (1 dia + janela de validação)

```bash
cd backend
npm install -D vitest@5            # corrige tinypool + mocker (crítico)
npm install -D prisma@7 && npm install @prisma/client@7   # corrige deepmerge-ts
npx prisma migrate dev             # validar geração do client na v7
npm test && npm run build && npm start   # smoke test completo
npm install mercadopago@latest     # validar Preference/Payment na major nova
npm audit                          # meta: 0 vulnerabilidades
```
Se Prisma 7 exigir mudanças maiores que a janela permite: pelo menos aplicar `overrides` para `deepmerge-ts@^8` — decisão documentada no README.

**CI (GitHub Actions ou similar)** — `.github/workflows/ci.yml`:
```yaml
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: nascente, POSTGRES_PASSWORD: nascente, POSTGRES_DB: nascente }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U nascente" --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: backend/package-lock.json }
      - run: npm ci
        working-directory: backend
      - run: npx prisma generate
        working-directory: backend
      - run: npm test
        working-directory: backend
      - run: npm run build
        working-directory: backend
      - run: npm audit --audit-level=high
        working-directory: backend
```
Adicionar ESLint (`typescript-eslint`, regras `no-restricted-syntax` para banir `innerHTML` no frontend e `as any`) e Prettier.

---

## 5. Checklist de validação — ✅ EXECUTADO em 2026-10-21 (servidor compilado + PostgreSQL Docker)

- [x] `npm audit` ⇒ **0 vulnerabilidades** em `backend/`
- [x] `npm test` ⇒ 14/14 (schemas, token de pedido, transição de pagamento, força-bruta admin)
- [x] Força-bruta: 5 falhas de `x-admin-token` ⇒ 6ª tentativa (mesmo com token correto) recebe **429** ✔ medido
- [x] `POST /orders` acima de 10/min ⇒ **429** ✔ medido
- [x] Webhook sem `x-signature` ⇒ **401 INVALID_WEBHOOK** ✔ medido
- [x] `GET /orders/:id` sem token ⇒ **401**; com token ⇒ **200** ✔ medido
- [x] `payment-preference` com token e MP não configurado ⇒ **503 fail-closed** ✔ medido
- [x] `GET /api/admin/orders/:id/address` ⇒ endereço retornado com auditoria ✔ medido
- [x] Payload XSS (`<img onerror>`) com `escapeHtml` ⇒ renderiza como texto, sem execução; CSP `script-src 'self'` ativa ✔ medido
- [x] Frontend sem erros de console; catálogo, carrinho e i18n funcionando ✔ medido
- [x] Headers: CSP, `X-Frame-Options`, `X-Content-Type-Options` presentes ✔ medido
- [ ] **Pendente operacional (produção):** pedido expirado cancelando e devolvendo estoque (job roda a cada 15 min; validar em ambiente com relógio avançado ou `ORDER_TTL_HOURS=1`) e rate limit por IP real atrás de proxy com `TRUST_PROXY=true`
- [ ] **Pendente operacional (produção):** restringir `/admin/` no proxy reverso (allowlist de IP)

## 6. Riscos residuais aceitos (documentar, não esquecer)

- **Token admin estático** permanece (sem sessão individual). Mitigado por: guard de força-bruta (5/15min), rate limit global, CSP, auditoria. Com rate limit + borda + HTTPS, risco aceitável para operação de uma pessoa. **Ação operacional pendente:** allowlist de IP no proxy reverso para `/admin/`.
- **Endereço em texto puro** no banco é necessário para entrega; mitigado por acesso único via endpoint auditado e retenção a definir (F-10). O **e-mail** agora tem forma criptografada (AES-256-GCM) para contato operacional.
- **Serviço de frete opcional**: sem contrato Correios, a cotação falha fechado (503) e o pedido segue "frete a combinar" — comportamento acordado e visível ao comprador no checkout. Com contrato ativo, recomenda-se exigir o token de frete em todo pedido.
- **Fallback da chave HMAC** (pedido e frete): sem `ORDER_ACCESS_SECRET`, a chave deriva de `DATABASE_URL` (estável entre reinícios). Quem tem a URL do banco já tem o banco — o token não acrescenta superfície. Recomenda-se definir `ORDER_ACCESS_SECRET` (e `EMAIL_ENC_KEY` para o e-mail criptografado) em produção.
- **SDK `mercadopago`** na major atual: sem CVE aberta; atualização de major é melhoria funcional, não de segurança.
