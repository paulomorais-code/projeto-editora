# Nascente

Site editorial e catálogo de livros da Nascente.

## Estrutura

```text
.
├── index.html              # Página inicial e catálogo
├── livro.html              # Template das páginas individuais de livros
├── assets/
│   ├── css/
│   │   └── styles.css      # Tokens, layout e componentes visuais
│   └── js/
│       ├── book-page.js    # Dados e comportamento da página de livro
│       ├── cart.js         # Carrinho, modal, checkout e agenda de eventos
│       └── i18n.js         # Traduções PT, FR e ES
└── README.md
```

## Backend

O backend fica em [`backend/`](./backend) e usa TypeScript, Fastify, PostgreSQL e Prisma.

```text
backend/
├── prisma/schema.prisma
└── src/
    ├── config/          # Variáveis de ambiente validadas
    ├── lib/             # Prisma e utilitários de segurança
    └── modules/
        ├── catalog/     # Catálogo público
        ├── orders/      # Pedidos e reserva transacional de estoque
        ├── payments/    # Mercado Pago e webhook assinado
        └── shipping/    # Adaptador para Correios
```

Para iniciar:

```bash
cd backend
cp .env.example .env
npm install
docker compose up -d postgres   # PostgreSQL local na porta 5433 (a 5432 pode estar ocupada por um Postgres nativo)
npx prisma generate             # Prisma 7 não roda generate automaticamente
npx prisma migrate dev --name initial
npm run db:seed
npm run build
```

Antes de produção, configure PostgreSQL, execute a migração Prisma e preencha as credenciais do Mercado Pago e dos Correios no ambiente do servidor. Nenhum segredo deve ser colocado no frontend ou versionado.

### Loja — o que já funciona de ponta a ponta

- **Capa do livro (PNG/JPG/WebP ou PDF)**: no painel, cada obra tem upload de capa (limite 10 MB). Imagens aparecem no catálogo e na página do livro; PDF aparece renderizado na página do livro. A capa é validada por **magic bytes** (arquivo renomeado é rejeitado), salva com **nome gerado pelo servidor** (sem risco de path traversal) e servida com cache longo e mime da whitelist. Sem capa, vale a capa colorida gerada em CSS.
- **Checkout com frete**: ao digitar o CEP, o frontend cota o frete (`POST /api/shipping/quote`) e mostra as opções (serviço, preço, prazo). A opção escolhida segue no pedido como **token assinado por HMAC** — o servidor revalida CEP, peso e validade, e o cliente nunca dita o preço do frete. Sem cotação, o pedido segue como "frete a combinar" (custo 0).
- **Páginas de retorno do pagamento**: `/pagamento/sucesso|falha|pendente` mostram o resumo do pedido. O Mercado Pago devolve o comprador com o ID e o token do pedido no fragmento da URL (`#pedido=…&token=…`).
- **Página "Seu pedido"** (`pedido.html`): o comprador acompanha status, pagamento, itens e **código de rastreio** com o link/token recebido — sem precisar de conta.
- **Fulfillment no painel**: endereço de entrega, e-mail de contato (descriptografado sob auditoria), código de rastreio, status e ativar/desativar produtos.
- **Cancelamento com reposição**: cancelar um pedido não pago (painel ou expiração automática de 24 h) devolve o estoque reservado.

### Segurança implementada

- `EDITOR_API_TOKEN` e `ORDER_ACCESS_SECRET` **devem ser gerados com `openssl rand -base64 48`**. O painel fica em `/admin/admin.html`: em produção, restrinja-o no proxy reverso (allowlist de IP) e sirva apenas sob HTTPS. Tentativas inválidas de token admin são bloqueadas por 15 min após 5 falhas.
- O painel registra auditoria (`admin_action`) de cada mutação; o endereço de entrega só é acessível por `GET /api/admin/orders/:id/address`, autenticado e auditado.
- Pedidos individuais exigem o token de acesso devolvido na criação (`accessToken`), enviado como `x-order-token` — proteção anti-IDOR. O token também segue nas `back_urls` do Mercado Pago.
- `POST /orders` e `payment-preference` têm rate limit de 10/min por IP; o global é 100/min. Com a API atrás de proxy reverso, defina `TRUST_PROXY=true` para o limite contar o IP real do cliente.
- Pedidos `PENDING` não pagos são cancelados e devolvem o estoque após `ORDER_TTL_HOURS` (padrão 24h).
- Respostas de provedores externos (Correios) são validadas com Zod antes de serem repassadas.
- Headers de segurança (CSP, HSTS em produção, anti-clickjacking) via Helmet; o frontend estático aplica CSP `script-src 'self'`.
- Vulnerabilidades de dependência: `npm audit` = 0 (Prisma 7.10.1 com driver adapter, Vitest 5).

### Operação e produção

- `docker compose up -d postgres` inicia o PostgreSQL local (porta 5433 do host; ajuste `DATABASE_URL` se necessário).
- `npx prisma migrate dev --name initial` cria a migração local; em produção use `npx prisma migrate deploy` e rode `npx prisma generate` e `npm run db:seed` explicitamente (o Prisma 7 não os executa automaticamente).
- `npm run db:seed` cadastra os três livros com estoque inicial zero. O estoque deve ser alterado pelo painel administrativo depois da conferência física.
- `EDITOR_API_TOKEN`, `ORDER_ACCESS_SECRET` e `EMAIL_ENC_KEY` devem ser segredos aleatórios gerados com `openssl rand -base64 48` (mínimo 32 caracteres). O painel fica em `/admin/admin.html` e nunca deve ser exposto sem HTTPS, controle adicional de acesso (allowlist de IP no proxy) e o guard anti-força-bruta ativo. `ADMIN_API_TOKEN` continua aceito para compatibilidade com instalações antigas.
- **LGPD**: o e-mail do comprador é guardado em duas formas — hash SHA-256 (busca) e **AES-256-GCM** (contato operacional). O e-mail descriptografado só sai pelo endpoint auditado `GET /api/admin/orders/:id/contact`.
- Configure no Mercado Pago a URL `https://SEU_DOMINIO/api/payments/mercadopago/webhook` e o segredo de assinatura. O webhook consulta o pagamento na API antes de marcar o pedido como pago e ignora eventos duplicados.
- A integração dos Correios usa `CORREIOS_BASE_URL`, `CORREIOS_CLIENT_ID`, `CORREIOS_CLIENT_SECRET` e contrato. O formato final de cotação depende do produto/API contratados pelos Correios; o adaptador falha fechado quando a configuração está incompleta.
- O frontend abre um checkout sem dados de cartão e redireciona para o Mercado Pago. Nunca implemente captura de cartão no site.
- Existem dois perfis: comprador, que acessa o catálogo público, e editor, que usa `/admin/admin.html` com `EDITOR_API_TOKEN` para cadastrar obras, ajustar preços/estoque e acompanhar pedidos. Novas obras publicadas no banco aparecem automaticamente no catálogo público quando o backend está disponível.
- Não registre endereço, e-mail, tokens ou payloads completos nos logs. Defina retenção e exclusão de dados conforme a LGPD.

## Fluxo de desenvolvimento

1. Abra `index.html` para navegar pelo catálogo.
2. Use “Saiba mais” para acessar `livro.html?livro=...`.
3. Mantenha estilos em `assets/css/styles.css`.
4. Separe interações por responsabilidade em `assets/js/`.
5. O catálogo inaugural reúne `A vida em Goiás`, `Brasília: da capital do progresso à capital da ordem` e `Cadernos do mundo 2027 para países periféricos`.
6. Ao adicionar uma obra, atualize os dados em `assets/js/cart.js` e `assets/js/book-page.js`, além dos cards em `index.html`.

O projeto não depende de servidor ou build neste estágio e pode ser aberto diretamente no navegador.
