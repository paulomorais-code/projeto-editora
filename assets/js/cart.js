const toast = document.querySelector(".toast");
const count = document.querySelector(".cart-count");
const drawer = document.querySelector(".cart-drawer");
const overlay = document.querySelector(".overlay");
const modal = document.querySelector(".book-modal");
const cartItems = document.querySelector(".cart-items");
const cartEmpty = document.querySelector(".cart-empty");
const cartSummary = document.querySelector(".cart-summary");
const cart = new Map();
// localStorage pode estar corrompido (análise F-13): nunca derrubar o script inteiro por causa disso.
let savedCart = {};
try {
  savedCart = JSON.parse(localStorage.getItem("nascente-cart") || "{}");
} catch {
  localStorage.removeItem("nascente-cart");
}
Object.values(savedCart).forEach((item) => {
  const product = item.product || item;
  if (product.title) cart.set(product.title, { product, quantity: item.quantity || 1 });
});

let products = {
  "A vida em Goiás": {
    category: "Literatura e território",
    price: 78,
    color: "book-navy",
    slug: "a-vida-em-goias",
    weightGrams: 280,
    description:
      "Entre estradas, cidades pequenas e paisagens que guardam muitas camadas de tempo, este livro acompanha uma vida em Goiás sem transformar o território em cenário. A obra investiga pertencimento, memória e deslocamento, reunindo uma escrita atenta às vozes que formam o centro-oeste brasileiro.",
  },
  "Brasília: da capital do progresso à capital da ordem": {
    category: "Brasília",
    price: 64,
    color: "book-red",
    slug: "brasilia-da-capital-do-progresso-a-capital-da-ordem",
    weightGrams: 340,
    description:
      "Uma leitura crítica da trajetória de Brasília e das forças que transformaram a capital do progresso em capital da ordem.",
  },
  "Cadernos do mundo 2027 para países periféricos": {
    category: "Mundo",
    price: 72,
    color: "book-sand",
    slug: "cadernos-do-mundo-2027",
    weightGrams: 310,
    description:
      "Uma coleção de ensaios sobre os futuros que se abrem para os países periféricos, entre soberania, trabalho, tecnologia e dependência.",
  },
};

let selectedProduct = null;

function catalogApiUrl() {
  return (
    window.NASCENTE_API_URL || (window.location.protocol === "file:" ? "http://localhost:3333/api" : "/api")
  );
}

// Tenta a API na mesma origem (produção com proxy) e depois localhost:3333 (dev sem proxy).
function apiCandidates() {
  return window.NASCENTE_API_URL ? [window.NASCENTE_API_URL] : ["/api", "http://localhost:3333/api"];
}

async function fetchFirstOk(path) {
  for (const base of apiCandidates()) {
    try {
      const response = await fetch(`${base}${path}`);
      if (response.ok) return { base, response };
    } catch {
      // origem indisponível: tenta a próxima
    }
  }
  return null;
}

function productColor(slug) {
  return ["book-navy", "book-red", "book-sand", "book-green", "book-orange"][
    slug.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5
  ];
}

let categoriaAtiva = "todas";

function renderCatalog(apiBase) {
  const grid = document.querySelector(".catalog-section .book-grid");
  if (!grid) return;
  const api = apiBase || catalogApiUrl();
  const todos = Object.values(products);
  const categorias = [...new Set(todos.map((product) => product.category))].sort((a, b) =>
    a.localeCompare(b, "pt"),
  );
  if (categoriaAtiva !== "todas" && !categorias.includes(categoriaAtiva)) categoriaAtiva = "todas";

  // Filtros por categoria (aparecem a partir de 2 categorias)
  const secao = document.querySelector(".catalog-section");
  let filtros = secao?.querySelector(".catalog-filters");
  if (categorias.length >= 2 && secao) {
    if (!filtros) {
      filtros = document.createElement("div");
      filtros.className = "catalog-filters";
      grid.before(filtros);
    }
    const opcoes = ["todas", ...categorias];
    filtros.innerHTML = opcoes
      .map((cat) => {
        const rotulo = cat === "todas" ? uiText("filterAll", "Todas") : window.escapeHtml(cat);
        const ativa = cat === categoriaAtiva ? " active" : "";
        return `<button type="button" class="catalog-filter${ativa}" data-categoria="${window.escapeHtml(cat)}">${rotulo}</button>`;
      })
      .join("");
  } else if (filtros) {
    filtros.remove();
  }

  grid.innerHTML = todos
    .map((product) => {
      const oculto = categoriaAtiva !== "todas" && product.category !== categoriaAtiva ? " hidden" : "";
      const cover =
        product.coverKind === "image"
          ? `<img class="cover-photo" src="${api}/products/${encodeURIComponent(product.slug)}/cover" alt="Capa: ${window.escapeHtml(product.title)}">`
          : `<small>NASCENTE / ${window.escapeHtml(product.category.toUpperCase())}</small><strong>${window.escapeHtml(product.title)}</strong><i></i><span>AUTOR ANÔNIMO</span>`;
      return `
    <article class="book-card${oculto}" data-categoria="${window.escapeHtml(product.category)}" tabindex="0" role="button">
      <div class="book-stage"><div class="book-cover ${product.color} ${product.coverKind === "image" ? "has-photo" : ""}">${cover}</div></div>
      <p class="book-category">${window.escapeHtml(product.category)}</p><h3>${window.escapeHtml(product.title)}</h3><p class="book-author">Autor anônimo</p>
      <div class="price-row"><b>${formatPrice(product.price)}</b><a class="learn-more" href="livro.html?livro=${encodeURIComponent(product.slug)}">Saiba mais</a><button data-add="${window.escapeHtml(product.title)}">Adicionar +</button></div>
    </article>`;
    })
    .join("");
  grid.querySelectorAll(".book-card").forEach((card) => {
    const title = card.querySelector("h3").textContent.trim();
    card.addEventListener("click", (event) => {
      if (!event.target.closest("button") && !event.target.closest("a")) openBook(title);
    });
  });
  grid
    .querySelectorAll("[data-add]")
    .forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.add)));
}

// Filtros por categoria (delegação no container: os botões são recriados a cada render)
document.querySelector(".catalog-section")?.addEventListener("click", (event) => {
  const botao = event.target.closest(".catalog-filter");
  if (!botao) return;
  categoriaAtiva = botao.dataset.categoria;
  renderCatalog(apiBaseAtual || undefined);
});

let ultimoCatalogoJson = "";
let apiBaseAtual = null;

function applyRemoteCatalog(remoteProducts, base) {
  const serializado = JSON.stringify(remoteProducts);
  // Re-renderiza somente quando o conteúdo mudar (evita "piscadas" a cada ciclo).
  if (
    serializado === ultimoCatalogoJson &&
    base === apiBaseAtual &&
    document.querySelector(".catalog-section .book-card")
  )
    return;
  ultimoCatalogoJson = serializado;
  apiBaseAtual = base;
  products = Object.fromEntries(
    remoteProducts.map((product) => [
      product.title,
      {
        ...product,
        price: product.priceCents / 100,
        color: productColor(product.slug),
      },
    ]),
  );
  renderCatalog(base);
}

async function loadRemoteCatalog() {
  const found = await fetchFirstOk("/products");
  if (!found) return;
  const { products: remoteProducts } = await found.response.json();
  applyRemoteCatalog(remoteProducts, found.base);
}

// Atualização harmônica: livros novos e preços aparecem sem o comprador recarregar a página.
async function refreshCatalogIfChanged() {
  if (document.hidden || typeof fetchFirstOk !== "function") return;
  const found = await fetchFirstOk("/products");
  if (found) applyRemoteCatalog((await found.response.json()).products, found.base);
}
setInterval(() => void refreshCatalogIfChanged(), 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshCatalogIfChanged();
});
// Troca de idioma: re-render do catálogo (rótulos de filtro e conteúdo dinâmico)
window.addEventListener("nascente:language", () => renderCatalog(apiBaseAtual || undefined));

function formatPrice(value) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function uiText(key, fallback) {
  return window.uiTranslations?.[window.currentLanguage || "pt"]?.[key] || fallback;
}

function totalItems() {
  return [...cart.values()].reduce((total, item) => total + item.quantity, 0);
}

function getNascenteCartItems() {
  return [...cart.values()].map(({ product, quantity }) => ({ slug: product.slug, quantity }));
}

// Peso total do carrinho em gramas (para a cotação de frete); 300 g é o padrão por livro.
function getNascenteCartWeight() {
  return [...cart.values()].reduce(
    (weight, { product, quantity }) => weight + (product.weightGrams || 300) * quantity,
    0,
  );
}

window.getNascenteCartItems = getNascenteCartItems;
window.getNascenteCartWeight = getNascenteCartWeight;

function renderCart() {
  const items = [...cart.values()];
  count.textContent = totalItems();
  cartItems.innerHTML = items
    .map(
      ({ product, quantity }) => `
    <article class="cart-item">
      <div class="mini-cover ${product.color}">${window.escapeHtml((product.category || "Nascente").split(" ")[0])}</div>
      <div class="cart-item-info"><h3>${window.escapeHtml(product.title)}</h3><small>${formatPrice(product.price)}</small>
        <div class="quantity"><button data-decrease="${window.escapeHtml(product.title)}" aria-label="Diminuir quantidade">−</button><span>${quantity}</span><button data-increase="${window.escapeHtml(product.title)}" aria-label="Aumentar quantidade">+</button></div>
      </div>
      <button class="remove-item" data-remove="${window.escapeHtml(product.title)}" aria-label="Remover ${window.escapeHtml(product.title)}">×</button>
    </article>
  `,
    )
    .join("");
  const subtotal = items.reduce((total, { product, quantity }) => total + product.price * quantity, 0);
  cartEmpty.hidden = items.length > 0;
  cartSummary.hidden = items.length === 0;
  cartSummary.querySelector("strong").textContent = formatPrice(subtotal);
  localStorage.setItem(
    "nascente-cart",
    JSON.stringify(
      Object.fromEntries(
        [...cart].map(([title, item]) => [title, { ...item.product, quantity: item.quantity }]),
      ),
    ),
  );
}

function addToCart(title) {
  const product = products[title];
  const current = cart.get(title);
  cart.set(title, { product: { ...product, title }, quantity: current ? current.quantity + 1 : 1 });
  renderCart();
  loadRemoteCatalog();
  showToast(`${title} ${uiText("added", "foi adicionado ao carrinho.")}`);
}

function openCart() {
  renderCart();
  drawer.classList.add("open");
  overlay.classList.add("visible");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closeCart() {
  drawer.classList.remove("open");
  overlay.classList.remove("visible");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
}

function openBook(title) {
  const product = products[title];
  selectedProduct = title;
  document.querySelector("#modal-category").textContent = product.category;
  document.querySelector("#modal-category").dataset.sourceCategory = product.category;
  document.querySelector("#modal-title").textContent = title;
  document.querySelector("#modal-description").textContent = product.description;
  document.querySelector("#modal-price").textContent = formatPrice(product.price);
  document.querySelector("[data-modal-more]").href = `livro.html?livro=${product.slug}`;
  document.querySelector(".modal-cover").className = `modal-cover ${product.color}`;
  modal.classList.add("open");
  overlay.classList.add("visible");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closeModal() {
  modal.classList.remove("open");
  overlay.classList.remove("visible");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
}

document.querySelectorAll(".book-card").forEach((card) => {
  const title = card.querySelector("h3")?.textContent.trim();
  if (!title || !products[title]) return;
  card.setAttribute("tabindex", "0");
  card.setAttribute("role", "button");
  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    openBook(title);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") openBook(title);
  });
});

document.querySelectorAll("[data-add]").forEach((button) => {
  button.addEventListener("click", () => addToCart(button.dataset.add));
});

document.querySelector(".cart-button").addEventListener("click", openCart);
document.querySelector("[data-close-cart]").addEventListener("click", closeCart);
document.querySelector("[data-close-modal]").addEventListener("click", closeModal);
overlay.addEventListener("click", () => {
  closeCart();
  closeModal();
});
document.querySelector("[data-modal-add]").addEventListener("click", () => {
  addToCart(selectedProduct);
  closeModal();
  openCart();
});

cartItems.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const title = button.dataset.increase || button.dataset.decrease || button.dataset.remove;
  const item = cart.get(title);
  if (!item) return;
  if (button.dataset.remove || (button.dataset.decrease && item.quantity === 1)) cart.delete(title);
  else if (button.dataset.decrease) item.quantity -= 1;
  else item.quantity += 1;
  renderCart();
});

document.querySelector("[data-checkout]").addEventListener("click", () => {
  showToast(uiText("checkoutMessage", "Checkout preparado para a próxima etapa da loja."));
});

document.querySelectorAll("[data-event-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const selected = tab.dataset.eventTab;
    document.querySelectorAll("[data-event-tab]").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-event-panel]").forEach((panel) => {
      const active = panel.dataset.eventPanel === selected;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  });
});

const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector(".desktop-nav");
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!open));
  nav.classList.toggle("mobile-open", !open);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeCart();
  closeModal();
});

renderCart();
// Catálogo remoto logo na carga (preços, capas e livros novos) — o HTML estático é o fallback.
loadRemoteCatalog();
