// Página de status do pedido: usada pelas páginas de retorno do pagamento (/pagamento/*)
// e por pedido.html. O comprador prova posse com o token recebido no checkout.
(function () {
  const params = new URLSearchParams((location.hash || location.search).replace(/^#/, "?"));
  // outcome vem do body da página (sucesso | falha | pendente) e só muda o texto do banner.
  const outcome = document.body.dataset.outcome || null; // eslint-disable-line no-unused-vars

  function storedOrder() {
    try {
      return JSON.parse(sessionStorage.getItem("nascente-last-order") || "null");
    } catch {
      return null;
    }
  }

  const orderId = params.get("pedido") || storedOrder()?.id;
  const orderToken = params.get("token") || storedOrder()?.token;
  // Candidatos de API: mesma origem (produção com proxy) e depois localhost:3333 (dev sem proxy).
  const apiCandidates = window.NASCENTE_API_URL
    ? [window.NASCENTE_API_URL]
    : ["/api", "http://localhost:3333/api"];

  const STATUS_LABEL = {
    PENDING: "Aguardando pagamento",
    PAID: "Pago — em preparação",
    PACKING: "Em embalagem",
    SHIPPED: "Enviado",
    DELIVERED: "Entregue",
    CANCELLED: "Cancelado",
  };
  const PAYMENT_LABEL = {
    PENDING: "Pagamento pendente",
    APPROVED: "Pagamento aprovado",
    REJECTED: "Pagamento recusado",
    REFUNDED: "Reembolsado",
  };

  function money(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  let lastOrder = null; // eslint-disable-line no-unused-vars -- exposto para depuração via console

  function render(order) {
    lastOrder = order;
    const root = document.querySelector("#order-root");
    const items = order.items
      .map(
        (item) =>
          `<li>${window.escapeHtml(item.title)} × ${item.quantity} — ${money(item.unitCents / 100)}</li>`,
      )
      .join("");
    const frete =
      order.shippingCents > 0
        ? `<p>Frete (${window.escapeHtml(order.shippingMethod || "")}): ${money(order.shippingCents / 100)}</p>`
        : "<p>Frete: a combinar com a editora</p>";
    const tracking = order.trackingCode
      ? `<p><strong>Código de rastreio:</strong> ${window.escapeHtml(order.trackingCode)}</p>`
      : "";
    root.innerHTML = `
      <p class="order-status-line"><strong>${STATUS_LABEL[order.status] || order.status}</strong> · ${PAYMENT_LABEL[order.paymentStatus] || order.paymentStatus}</p>
      <ul>${items}</ul>
      ${frete}
      <p><strong>Total: ${money(order.totalCents / 100)}</strong></p>
      ${tracking}
      <p class="order-id">Pedido <code>${window.escapeHtml(order.id)}</code> — guarde este link para acompanhar.</p>
    `;
  }

  function renderError(message) {
    document.querySelector("#order-root").innerHTML =
      `<p>${window.escapeHtml(message)}</p><a class="text-link" href="${document.body.dataset.home || "index.html"}#catalogo">Voltar ao catálogo →</a>`;
  }

  if (!orderId || !orderToken) {
    renderError(
      "Não encontramos os dados do seu pedido neste navegador. Use o link enviado na confirmação da compra.",
    );
    return;
  }

  function loadOrder() {
    const attempt = (index) => {
      if (index >= apiCandidates.length) {
        renderError("Não foi possível carregar o pedido agora. Tente novamente em instantes.");
        return;
      }
      fetch(`${apiCandidates[index]}/orders/${encodeURIComponent(orderId)}`, {
        headers: { "x-order-token": orderToken },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("order");
          return response.json();
        })
        .then((result) => render(result.order))
        .catch(() => attempt(index + 1));
    };
    attempt(0);
  }

  document.querySelector("#order-refresh")?.addEventListener("click", loadOrder);
  loadOrder();
})();
