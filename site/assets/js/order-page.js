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

  function uiText(key, fallback) {
    return window.uiTranslations?.[window.currentLanguage || "pt"]?.[key] || fallback;
  }

  const STATUS_LABEL = () => ({
    PENDING: uiText("orderAwaiting", "Aguardando pagamento"),
    PAID: uiText("orderPaid", "Pago — em preparação"),
    PACKING: uiText("orderPacking", "Em embalagem"),
    SHIPPED: uiText("orderShipped", "Enviado"),
    DELIVERED: uiText("orderDelivered", "Entregue"),
    CANCELLED: uiText("orderCancelled", "Cancelado"),
  });
  const PAYMENT_LABEL = () => ({
    PENDING: uiText("payPending", "Pagamento pendente"),
    APPROVED: uiText("payApproved", "Pagamento aprovado"),
    REJECTED: uiText("payRejected", "Pagamento recusado"),
    REFUNDED: uiText("payRefunded", "Reembolsado"),
  });

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
        ? `<p>${uiText("orderShipping", "Frete")} (${window.escapeHtml(order.shippingMethod || "")}): ${money(order.shippingCents / 100)}</p>`
        : `<p>${uiText("orderShippingTbd", "Frete: a combinar com a editora")}</p>`;
    const tracking = order.trackingCode
      ? `<p><strong>${uiText("orderTracking", "Código de rastreio:")}</strong> ${window.escapeHtml(order.trackingCode)}</p>`
      : "";
    const statusLabels = STATUS_LABEL();
    const paymentLabels = PAYMENT_LABEL();
    root.innerHTML = `
      <p class="order-status-line"><strong>${statusLabels[order.status] || order.status}</strong> · ${paymentLabels[order.paymentStatus] || order.paymentStatus}</p>
      <ul>${items}</ul>
      ${frete}
      <p><strong>${uiText("orderTotal", "Total")}: ${money(order.totalCents / 100)}</strong></p>
      ${tracking}
      <p class="order-id">${uiText("orderIdLabel", "Pedido")} <code>${window.escapeHtml(order.id)}</code> ${uiText("orderKeepLink", "— guarde este link para acompanhar.")}</p>
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
        renderError(
          uiText("orderLoadError", "Não foi possível carregar o pedido agora. Tente novamente em instantes."),
        );
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
