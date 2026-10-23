/**
 * Executado pelo vitest ANTES de qualquer módulo de teste importar o código da app.
 * Garante segredos/variáveis para CI (onde não existe .env) sem sobrescrever o .env local.
 */
process.env.DATABASE_URL ||= "postgresql://nascente:nascente@localhost:5433/nascente?schema=public";
process.env.EDITOR_API_TOKEN ||= "test-editor-token-0123456789abcdef0123456789abcdef";
process.env.ORDER_ACCESS_SECRET ||= "test-order-secret-0123456789abcdef0123456789abcdef";
process.env.EMAIL_ENC_KEY ||= "test-email-key-0123456789abcdef0123456789abcdef";
process.env.MERCADOPAGO_WEBHOOK_SECRET ||= "test-webhook-secret-0123456789abcdef";
// Mercado Pago NUNCA recebe token aqui: os testes de pagamento-validação esperam 503 fail-closed.
