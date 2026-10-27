const api = "/api";
// Dados vindos da API (título, slug) não podem entrar em innerHTML sem escape (análise F-04).
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const token = () => document.querySelector("#token").value;
const request = (path, options = {}) => fetch(`${api}${path}`, { ...options, headers: { "content-type": "application/json", "x-admin-token": token(), ...(options.headers || {}) } }).then(async (response) => { if (!response.ok) throw new Error((await response.json()).error || "Erro"); return response.json(); });
const money = (cents) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

async function load() {
  const status = document.querySelector("#status");
  try {
    const [{ products }, { orders }] = await Promise.all([request("/admin/products"), request("/admin/orders")]);
    document.querySelector("#products").innerHTML = products.map((product) => `<tr style="${product.active ? "" : "opacity:.45"}"><td>${escapeHtml(product.title)}<br><small>${escapeHtml(product.slug)} · ${product.weightGrams} g · ${escapeHtml(product.collection || "sem coleção")}${product.featured ? " · ★" : ""}${product.hasCover ? ` · capa ✓ (${escapeHtml(product.coverKind)})` : " · sem capa"}</small></td><td><input data-price="${escapeHtml(product.id)}" type="number" min="0.01" step="0.01" value="${(product.priceCents / 100).toFixed(2)}"><br><input data-promo="${escapeHtml(product.id)}" type="number" min="0" step="0.01" placeholder="promo R$" style="width:90px" value="${product.promoPriceCents ? (product.promoPriceCents / 100).toFixed(2) : ""}"></td><td><input data-stock="${escapeHtml(product.id)}" type="number" min="0" value="${product.stock}"><br><input data-collection="${escapeHtml(product.id)}" placeholder="coleção" style="width:100px" value="${escapeHtml(product.collection || "")}"></td><td><input type="file" data-cover-input="${escapeHtml(product.id)}" accept=".png,.jpg,.jpeg,.webp,.pdf" style="max-width:150px"> <button data-cover-save="${escapeHtml(product.id)}">Capa</button>${product.hasCover ? ` <button data-cover-del="${escapeHtml(product.id)}">Remover capa</button>` : ""}<br><button data-save="${escapeHtml(product.id)}">Salvar</button> <button data-featured="${escapeHtml(product.id)}" data-next-featured="${product.featured ? "false" : "true"}">${product.featured ? "Remover ★" : "Destacar ★"}</button> <button data-toggle-active="${escapeHtml(product.id)}" data-next-active="${product.active ? "false" : "true"}">${product.active ? "Desativar" : "Ativar"}</button></td></tr>`).join("");
    document.querySelector("#orders").innerHTML = orders.map((order) => `<tr><td>${escapeHtml(order.id.slice(-8))}<br><small>${escapeHtml(order.paymentStatus)}${order.shippingCents > 0 ? ` + frete ${money(order.shippingCents)}` : " · frete a combinar"}</small></td><td>${money(order.totalCents)}</td><td><select data-status="${escapeHtml(order.id)}">${["PENDING","PAID","PACKING","SHIPPED","DELIVERED","CANCELLED"].map((value) => `<option ${value === order.status ? "selected" : ""}>${value}</option>`).join("")}</select></td><td><input data-tracking="${escapeHtml(order.id)}" placeholder="Rastreio" value="${escapeHtml(order.trackingCode || "")}" size="12"> <button data-tracking-save="${escapeHtml(order.id)}">Rastreio</button><br><button data-address="${escapeHtml(order.id)}">Endereço</button> <button data-contact="${escapeHtml(order.id)}">Contato</button> <button data-order-save="${escapeHtml(order.id)}">Status</button></td></tr>`).join("");
    status.textContent = "Dados carregados.";
  } catch (error) { status.textContent = error.message; }
}

function showDetail(title, body) {
  const target = document.querySelector("#status");
  target.textContent = `${title}: ${body}`;
}

// Upload de capa usa multipart: fetch SEM content-type manual (o navegador define o boundary).
async function uploadCoverFile(productId, file) {
  const response = await fetch(`${api}/admin/products/${encodeURIComponent(productId)}/cover`, {
    method: "POST",
    headers: { "x-admin-token": token() },
    body: (() => { const fd = new FormData(); fd.append("cover", file); return fd; })()
  });
  if (!response.ok) throw new Error((await response.json()).error || "Falha no upload");
  return response.json();
}

async function uploadCover(productId, fileInput) {
  const file = fileInput.files?.[0];
  if (!file) throw new Error("Escolha um arquivo PNG/JPG/WebP ou PDF.");
  await uploadCoverFile(productId, file);
  fileInput.value = "";
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-save],button[data-order-save],button[data-tracking-save],button[data-address],button[data-contact],button[data-toggle-active],button[data-cover-save],button[data-cover-del],button[data-featured]");
  if (!button) return;
  try {
    if (button.dataset.coverSave) {
      const input = document.querySelector(`[data-cover-input="${button.dataset.coverSave}"]`);
      const result = await uploadCover(button.dataset.coverSave, input);
      showDetail("Capa enviada", `tipo: ${result.product.coverKind}`);
      input.value = "";
    }
    if (button.dataset.coverDel) {
      await request(`/admin/products/${button.dataset.coverDel}/cover`, { method: "DELETE" });
      showDetail("Capa removida", button.dataset.coverDel.slice(-8));
    }
    if (button.dataset.save) {
      const id = button.dataset.save;
      await request(`/admin/products/${id}/stock`, { method: "PATCH", body: JSON.stringify({ stock: Number(document.querySelector(`[data-stock="${id}"]`).value) }) });
      await request(`/admin/products/${id}/price`, { method: "PATCH", body: JSON.stringify({ priceCents: Math.round(Number(document.querySelector(`[data-price="${id}"]`).value) * 100) }) });
      const promoVal = document.querySelector(`[data-promo="${id}"]`).value.trim();
      const payload = { promoPriceCents: promoVal === "" ? null : Math.round(Number(promoVal) * 100) };
      await request(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      const collection = document.querySelector(`[data-collection="${id}"]`).value.trim();
      if (collection !== (document.querySelector(`[data-collection="${id}"]`).dataset.original ?? "")) {
        await request(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify({ collection: collection === "" ? null : collection }) });
      }
    }
    if (button.dataset.featured) {
      const result = await request(`/admin/products/${button.dataset.featured}`, { method: "PATCH", body: JSON.stringify({ featured: button.dataset.nextFeatured === "true" }) });
      showDetail("Destaque", `${result.product.id.slice(-8)} → ${result.product.featured ? "★ em destaque" : "fora dos destaques"}`);
    }
    if (button.dataset.toggleActive) {
      await request(`/admin/products/${button.dataset.toggleActive}`, { method: "PATCH", body: JSON.stringify({ active: button.dataset.nextActive === "true" }) });
    }
    if (button.dataset.orderSave) await request(`/admin/orders/${button.dataset.orderSave}/status`, { method: "PATCH", body: JSON.stringify({ status: document.querySelector(`[data-status="${button.dataset.orderSave}"]`).value }) });
    if (button.dataset.trackingSave) {
      const code = document.querySelector(`[data-tracking="${button.dataset.trackingSave}"]`).value.trim();
      if (code) {
        const result = await request(`/admin/orders/${button.dataset.trackingSave}/tracking`, { method: "PATCH", body: JSON.stringify({ trackingCode: code }) });
        showDetail("Rastreio salvo", `${result.order.id.slice(-8)} → ${result.order.trackingCode}`);
      }
    }
    if (button.dataset.address) {
      const result = await request(`/admin/orders/${button.dataset.address}/address`);
      showDetail("Endereço de entrega", JSON.stringify(result.shippingAddress));
    }
    if (button.dataset.contact) {
      const result = await request(`/admin/orders/${button.dataset.contact}/contact`);
      showDetail("Contato do comprador", result.email || "indisponível");
    }
    await load();
  } catch (error) { document.querySelector("#status").textContent = error.message; }
});

document.querySelector("#load").addEventListener("click", load);

// Catálogo corrente em PDF (mesma mecânica multipart das capas)
async function publicarCatalogo(file) {
  const response = await fetch(`${api}/admin/catalog/pdf`, {
    method: "POST",
    headers: { "x-admin-token": token() },
    body: (() => { const fd = new FormData(); fd.append("catalog", file); return fd; })()
  });
  if (!response.ok) throw new Error((await response.json()).error || "Falha ao publicar");
  return response.json();
}
document.querySelector("#catalog-publish").addEventListener("click", async () => {
  const input = document.querySelector("#catalog-pdf");
  const status = document.querySelector("#catalog-status");
  if (!input.files?.[0]) { status.textContent = "Escolha um PDF."; return; }
  try {
    await publicarCatalogo(input.files[0]);
    status.textContent = "Catálogo publicado ✓ (link na vitrine)";
  } catch (error) { status.textContent = error.message; }
});
document.querySelector("#catalog-remove").addEventListener("click", async () => {
  const status = document.querySelector("#catalog-status");
  try {
    await request("/admin/catalog/pdf", { method: "DELETE" });
    status.textContent = "Catálogo removido.";
  } catch (error) { status.textContent = error.message; }
});

