const checkoutModal = document.querySelector(".checkout-modal");
const checkoutForm = document.querySelector(".checkout-form");
const checkoutError = document.querySelector(".checkout-error");
const shippingSelect = document.querySelector("#shipping-option");
const shippingNote = document.querySelector(".shipping-note");
const apiBase = window.NASCENTE_API_URL || "http://localhost:3333/api";

let currentQuote = null; // { quoteToken, options }

// Apenas URLs de checkout do Mercado Pago são aceitas para redirecionamento (análise F-14).
function isMercadoPagoCheckoutUrl(url) {
  return /^https:\/\/([a-z0-9-]+\.)*mercadopago\.(com|com\.br)\//i.test(url);
}

function closeCheckout() {
  checkoutModal.classList.remove("open");
  checkoutModal.setAttribute("aria-hidden", "true");
}

function formatPrice(value) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function uiText(key, fallback) {
  return window.uiTranslations?.[window.currentLanguage || "pt"]?.[key] || fallback;
}

function resetShipping() {
  currentQuote = null;
  shippingSelect.hidden = true;
  shippingSelect.innerHTML = "";
  shippingNote.hidden = false;
  shippingNote.textContent = uiText(
    "shippingCombine",
    "Frete a combinar com a editora após a confirmação do pagamento.",
  );
}

// Cota o frete quando o CEP sai de foco; as opções vêm com token assinado pela API.
async function loadShippingOptions() {
  const postalCode = checkoutForm.elements.postalCode.value.trim();
  if (!/^\d{5}-?\d{3}$/.test(postalCode)) return;
  shippingNote.hidden = false;
  shippingNote.textContent = uiText("shippingQuoting", "Consultando frete…");
  try {
    const response = await fetch(`${apiBase}/shipping/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postalCode, weightGrams: window.getNascenteCartWeight?.() || 300 }),
    });
    if (!response.ok) throw new Error("quote");
    const result = await response.json();
    currentQuote = result;
    shippingSelect.innerHTML = result.options
      .map((option, index) => {
        const prazo = option.deadlineDays ? ` · até ${option.deadlineDays} dias úteis` : "";
        return `<option value="${index}">${window.escapeHtml(option.service)} — ${formatPrice(option.priceCents / 100)}${prazo}</option>`;
      })
      .join("");
    shippingSelect.hidden = false;
    shippingNote.hidden = true;
  } catch {
    resetShipping();
  }
}

document.querySelector("[data-checkout]").addEventListener("click", () => {
  if (!window.getNascenteCartItems?.().length) return;
  resetShipping();
  checkoutModal.classList.add("open");
  checkoutModal.setAttribute("aria-hidden", "false");
});
document.querySelector("[data-close-checkout]").addEventListener("click", closeCheckout);
checkoutForm.elements.postalCode.addEventListener("change", loadShippingOptions);

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  checkoutError.textContent = "";
  const data = new FormData(checkoutForm);
  const shippingAddress = Object.fromEntries(
    ["name", "postalCode", "street", "number", "complement", "neighborhood", "city", "state"].map((key) => [
      key,
      data.get(key),
    ]),
  );
  const payload = { email: data.get("email"), items: window.getNascenteCartItems(), shippingAddress };
  if (currentQuote && shippingSelect.value !== "") {
    payload.shipping = { quoteToken: currentQuote.quoteToken, optionIndex: Number(shippingSelect.value) };
  }
  try {
    const response = await fetch(`${apiBase}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.order?.accessToken)
      throw new Error(result.error || "Não foi possível criar o pedido.");
    // Token de acesso ao pedido: prova de posse exigida pela API (anti-IDOR, análise F-06).
    sessionStorage.setItem(
      "nascente-last-order",
      JSON.stringify({ id: result.order.id, token: result.order.accessToken }),
    );
    const payment = await fetch(
      `${apiBase}/orders/${encodeURIComponent(result.order.id)}/payment-preference`,
      { method: "POST", headers: { "x-order-token": result.order.accessToken } },
    );
    const paymentResult = await payment.json();
    if (!payment.ok || !paymentResult.checkoutUrl)
      throw new Error(paymentResult.error || "Pagamento indisponível.");
    if (!isMercadoPagoCheckoutUrl(paymentResult.checkoutUrl)) throw new Error("Pagamento indisponível.");
    window.location.href = paymentResult.checkoutUrl;
  } catch (error) {
    checkoutError.textContent =
      error instanceof Error ? error.message : "Não foi possível finalizar o pedido.";
  }
});
