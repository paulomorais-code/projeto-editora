# AGENTS.md — Diretrizes para agentes de código (e humanas) neste repositório

Este arquivo orienta qualquer agente de IA ou pessoa contribuidora que for modificar o código da **Nascente** (editora/livraria independente). Leia antes de alterar qualquer arquivo.

---

## 1. Visão geral do projeto

Loja virtual de livros com duas partes desacopladas:

| Parte | Stack | Papel |
|---|---|---|
| **Frontend** (raiz) | HTML/CSS/JS vanilla, sem build | Catálogo público, carrinho, checkout (redireciona para Mercado Pago) |
| **Backend** (`backend/`) | TypeScript, Fastify 5, Prisma 7 (driver adapter pg), PostgreSQL 16, Zod 4 | API pública (`/api/*`), painel do editor (`/admin/*`), webhook Mercado Pago, adaptador Correios |

Regras de negócio essenciais (não quebre):

- **Preço e total são SEMPRE recalculados no servidor** a partir do banco. O cliente nunca informa preço.
- **Estoque é reservado transacionalmente** em `order.service.ts` com `updateMany` condicional (`stock >= quantity` + `decrement`). Não substitua por leitura + escrita simples (risco de oversell).
- **E-mail do comprador é armazenado apenas como hash SHA-256** (`hashForLookup` em `src/lib/security.ts`). Nunca introduza persistência de e-mail em texto puro (LGPD).
- **Nenhum dado de cartão passa pelo site.** O checkout redireciona para o Mercado Pago. Nunca implemente captura de cartão.
- **O webhook do Mercado Pago só marca pedido como pago após (a) validar assinatura HMAC `x-signature` e (b) reconsultar o pagamento na API do Mercado Pago.** Idempotência via constraint única `(provider, providerEventId)` em `PaymentEvent`. Status de pagamento só avança (`nextPaymentStatus`): nunca regride para `PENDING`; `REFUNDED` é terminal; pedido `CANCELLED` não volta a `PAID`.
- **Pedidos exigem token de acesso** (anti-IDOR): `createOrder` devolve `accessToken` (HMAC do ID, `signOrderId`); `GET /orders/:id` e `payment-preference` exigem `x-order-token`.
- **Frete é validado por token assinado** (`signQuoteToken`/`verifyQuoteToken`): a cotação (`POST /api/shipping/quote`) devolve opções + token HMAC com CEP, peso, validade (30 min) e preços; `createOrder` revalida tudo no servidor. Sem token ⇒ `shippingCents = 0` ("a combinar").
- **E-mail do comprador tem duas formas no banco**: hash (busca) e AES-256-GCM (contato). Descriptografia só no endpoint auditado de contato.
- **Pedidos `PENDING` não pagos expiram** após `ORDER_TTL_HOURS` (24h padrão): cancelamento + reposição de estoque compartilham `cancelAndRestock` (também usado no cancelamento manual do editor).
- Falhe fechado: integrações (Mercado Pago, Correios) sem configuração retornam `503`, nunca simulam sucesso.

## 2. Estrutura

```text
.
├── site/                        # Frontend público (estático)
│   ├── index.html / livro.html / catalogo.html / pedido.html
│   ├── pagamento/               # páginas de retorno do Mercado Pago
│   └── assets/js/               # cart.js, checkout.js, catalogo.js, book-page.js, i18n.js…
├── backend/
│   ├── prisma/                  # schema.prisma, migrações e seed.ts
│   ├── src/
│   │   ├── config/env.ts        # Variáveis de ambiente validadas com Zod (única fonte)
│   │   ├── lib/                 # prisma.ts, security.ts, admin-auth.ts, order-expiry.ts
│   │   ├── integration/         # testes de integração (banco real)
│   │   └── modules/
│   │       ├── catalog/         # GET /api/products, /api/catalog, capas, PDF
│   │       ├── orders/          # POST /api/orders, GET /api/orders/:id, payment-preference
│   │       ├── payments/        # Webhook Mercado Pago assinado + service
│   │       ├── shipping/        # POST /api/shipping/quote (Correios)
│   │       └── admin/           # Rotas protegidas + admin.html/admin.js servidos em /admin/
│   └── docker-compose.yml       # PostgreSQL local
├── docs/                        # ANALISE-SEGURANCA, DEPLOY, TESTE-LOJA
├── prototipo/                   # gerado: front + API simulada para o Netlify
├── scripts/gerar-prototipo.py   # regenera o protótipo
├── nginx/nascente.conf          # proxy de produção (allowlist do /admin/)
└── docker-compose.prod.yml      # app + Postgres + Nginx
```

`backend/dist/` é artefato de build (ignorado pelo git). Não edite; edite `src/` e rode `npm run build`.

## 3. Comandos

Todos os comandos de backend dentro de `backend/`:

```bash
docker compose up -d postgres        # banco local (porta 5433 — 5432 pode estar ocupado por Postgres nativo)
npm install
cp .env.example .env                 # e gere segredos reais (ver §5)
npx prisma generate                  # Prisma 7 NÃO roda generate automaticamente
npm run db:seed                      # 3 livros com estoque 0 (migrate dev também não roda seed em v7)
npx prisma migrate dev --name init   # desenvolvimento
npm run dev                          # tsx watch em :3333
npm test                             # vitest (config em vitest.config.ts; só src/**)
npm run build && npm start           # produção (node dist/server.js; build copia assets do admin)
npx prisma migrate deploy            # migração em produção
```

Frontend: sem build. Abrir `index.html` (funciona até via `file://`) ou servir a raiz com qualquer servidor estático. A URL da API é resolvida por `window.NASCENTE_API_URL` ou fallback `/api` / `http://localhost:3333/api`.

## 4. Convenções de código

- **TypeScript `strict`** com `noUncheckedIndexedAccess`. Sem `any` novo sem justificativa em comentário.
- **Módulos por domínio**: rota (thin) → schema Zod → service (regra de negócio). Rotas não falam com o Prisma diretamente quando há regra de negócio envolvida.
- **Erros de negócio com `AppError(code, status)`** (`src/lib/errors.ts`), convertidos pelo handler global em `{ error: code }`. Nunca `Error("CODE")` com string-matching em rotas (padrão antigo, eliminado).
- **Toda entrada externa passa por Zod** (body, params, query, e respostas de provedores externos — ex.: Correios) antes de tocar o banco ou vazar para o cliente. Mensagens para o cliente são **códigos estáveis** (`INVALID_ORDER`, `INSUFFICIENT_STOCK`…), nunca stack trace.
- **Nada de PII em logs**: o logger já faz `redact` de `authorization`, `cookie`, `*.email`, `*.shippingAddress`. Preserve essa lista ao mexer no logger; não logue payload de webhook (apenas hash) nem endereços.
- **Mudança de schema do Prisma** exige migração (`prisma migrate dev`); nunca `db push` em produção; nunca edite migrações antigas.
- **Frontend vanilla**: JS sem framework, sem bundler. Um arquivo por responsabilidade. Strings de UI novas entram nos 3 idiomas em `i18n.js` (pt/fr/es).
- **Dados de catálogo** existem em 3 lugares (API, `cart.js`, `book-page.js`, cards no `index.html`). Ao adicionar/alterar obra, atualize todos e o seed. Livros novos têm página de detalhe funcional (`book-page.js` cria objeto próprio para slug desconhecido).
- **Páginas de retorno** (`pagamento/sucesso|falha|pendente/index.html`) e `pedido.html` compartilham `assets/js/order-page.js`; o token do pedido viaja no **fragmento** da URL (`#pedido=…&token=…`) porque o Mercado Pago anexa os próprios parâmetros de query.
- **Upload de capa** (`src/lib/covers.ts`): validação por **magic bytes** (nunca pela extensão), nome de arquivo **gerado pelo servidor** (`productId-hash.ext`), limite 10 MB, arquivos em `backend/uploads/covers/` (fora do git). Servidos por `GET /api/products/:slug/cover` com mime da whitelist + header `Cross-Origin-Resource-Policy: cross-origin` (o site estático consome de outra origem; o helmet seta same-origin por padrão).

## 5. Invariantes de segurança (obrigatórias)

1. **Segredos nunca no repositório.** `.env` é ignorado pelo git — mantenha assim. `.env.example` contém apenas placeholders. Segredos novos entram em `src/config/env.ts` via Zod e no `.env.example` vazio. Variáveis opcionais vazias contam como "não definidas" (`emptyToUndefined` em `env.ts`).
2. **`EDITOR_API_TOKEN` deve ser aleatório de CSPRNG**, mínimo 32 caracteres: `openssl rand -base64 48`. Nunca token "digitado à mão" ou previsível. Rotacione se houver suspeita.
3. **Rotas `/api/admin/*` só via `requireAdmin`** (`timingSafeEqual` + guard anti-força-bruta: 5 falhas ⇒ bloqueio de 15 min por IP). Nova rota admin deve ficar dentro do `adminRoutes` para herdar o hook `preHandler` — não crie rota admin fora desse plugin. Toda mutação admin loga evento `admin_action`.
4. **Webhook de pagamento**: qualquer endpoint que mude `paymentStatus` DEVE validar a assinatura HMAC, aceitar apenas `dataId` numérico e reconsultar o provedor. Nunca confie no corpo do webhook. Use `nextPaymentStatus` (`src/modules/payments/payment-status.ts`) — status nunca regride para `PENDING`.
5. **HTML escaping no frontend**: dados vindos da API **nunca** entram em `innerHTML` sem `window.escapeHtml()` (`assets/js/dom.js`) — nem em texto, nem em atributos. `setHtml` do i18n é restrito a strings estáticas do dicionário. `index.html`/`livro.html` têm meta CSP `script-src 'self'` — código novo não pode usar script inline nem `onclick=`.
6. **Pedido acessível só com token**: endpoints de pedido individual exigem `x-order-token` (HMAC, `signOrderId`/`verifyOrderToken` em `src/lib/security.ts`). O token é entregue 1× na criação do pedido e propagado nas `back_urls`.
7. **Valores monetários em centavos (`Int`)** em todo o backend. Conversão para reais só na camada de apresentação.
8. **CORS**: apenas a origem de `FRONTEND_ORIGIN`, métodos `GET/POST/PATCH`. Não adicione `origin: "*"` nem credenciais.
9. **Rate limit**: global 100/min; `POST /orders` e `payment-preference` 10/min; admin com guard próprio. Rotas sensíveis novas ganham limite dedicado (`config: { rateLimit: ... }`). `TRUST_PROXY=true` só atrás de proxy reverso.
10. **Banco**: `docker-compose.yml` é só para desenvolvimento local (loopback + porta 5433). Nunca suba em produção com senha `nascente`.
11. **Dependências**: `npm audit` antes de abrir PR (hoje: 0 vulnerabilidades). Prisma 7 exige `npx prisma generate` e `npm run db:seed` manuais após `migrate dev`.

## 6. Checklist antes de finalizar qualquer tarefa

- [ ] `npm test` passa dentro de `backend/`
- [ ] `npm run build` compila sem erro
- [ ] Entradas novas validadas com Zod; erros retornam códigos estáveis
- [ ] Nenhum segredo, PII ou payload sensível em logs, testes ou fixtures versionadas
- [ ] Nenhum `innerHTML` novo com dado dinâmico sem escape
- [ ] Schema do Prisma alterado ⇒ migração criada
- [ ] README/`.env.example` atualizados se comportamento ou env mudou
- [ ] Teste unitário novo para regra de negócio nova (padrão: `*.test.ts` ao lado do arquivo)

## 7. O que NÃO fazer

- Não mover o painel admin para o frontend público nem embutir o token em código versionado.
- Não adicionar telemetria/analytics de terceiros sem revisão de privacidade (LGPD).
- Não "otimizar" a transação de estoque removendo o `updateMany` condicional.
- Não armazenar e-mail, telefone ou endereço em novo lugar sem discutir retenção/LGPD.
- Não expor rotas de escrita do catálogo sem `requireAdmin`.
- Não servir `src/modules/admin` em produção via `process.cwd()` em novos códigos — caminho deve ser resolvido por `import.meta.url` ou diretório copiado no build.

## 8. Estado da segurança e dívida restante

A análise completa, com os 20 achados de segurança e o status de cada correção, está em **`docs/ANALISE-SEGURANCA.md`** (§1.2). Situação em 2026-10-23: **18 de 20 achados corrigidos e verificados**, lacunas funcionais P0/P1 implementadas, e a maior parte do checklist de qualidade resolvida:

- ✅ **CI** (`.github/workflows/ci.yml`): Postgres de serviço, lint, migração, testes (unitários + integração), build, audit, prettier
- ✅ **ESLint + Prettier** na raiz (`eslint.config.js`, `.prettierrc`): bloqueia `as any`, `eval`, `no-console` no backend; warn de `innerHTML` no frontend (uso legítimo atual sempre com `escapeHtml`)
- ✅ **Testes de integração** (`backend/src/integration/`): concorrência de estoque, token anti-IDOR, webhook (válido/inválido/duplicado/regressão/referência desconhecida), expiração com reposição, fluxo admin completo, retenção LGPD
- ✅ **Retenção LGPD**: `RETENTION_DAYS` + `anonymizeOldOrders` (anonimiza endereço/e-mail de pedidos finalizados)
- ✅ **Kit de deploy**: `Dockerfile`, `docker-compose.prod.yml`, `nginx/nascente.conf` (com allowlist do `/admin/`), `.env.production.example`, `docs/DEPLOY.md`

Restante (depende de contas/decisões externas):

- **Mercado Pago real** (credenciais de produção + webhook) — requer conta vendedora aprovada
- **Correios real ou decisão formal de "frete a combinar"** — requer contrato/décision do editor
- **VPS + domínio + TLS** — seguir `docs/DEPLOY.md`; allowlist do `/admin/` já está no nginx.conf (ajustar IP)
- **Sessão individual no admin** (trocar token estático por login) — médio prazo se houver mais de um editor
- **Notificação automática ao comprador** (e-mail/transação): hoje o contato é manual via endpoint auditado
