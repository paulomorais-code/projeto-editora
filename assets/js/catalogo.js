// Catálogo corrente (estilo LOM): busca, filtros, novidades, paginação e mais-vendidos.
(function () {
  const apiCandidates = window.NASCENTE_API_URL
    ? [window.NASCENTE_API_URL]
    : ["/api", "http://localhost:3333/api"];
  let apiBase = apiCandidates[0];

  function uiText(key, fallback) {
    return window.uiTranslations?.[window.currentLanguage || "pt"]?.[key] || fallback;
  }

  function money(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  let pagina = 1;
  let ultimaConsulta = "";
  const porSlug = new Map(); // slug → produto (para adicionar ao carrinho no formato da index)
  const grid = document.querySelector("#catalogo-grid");
  const mais = document.querySelector("#catalogo-mais");
  const inputQ = document.querySelector("#catalogo-q");
  const selCategoria = document.querySelector("#catalogo-categoria");
  const selColecao = document.querySelector("#catalogo-colecao");
  const chkNovidades = document.querySelector("#catalogo-novidades");

  function cardHtml(api, product) {
    const cover =
      product.coverKind === "image"
        ? `<img class="cover-photo" src="${api}/products/${encodeURIComponent(product.slug)}/cover" alt="Capa: ${window.escapeHtml(product.title)}">`
        : `<small>NASCENTE / ${window.escapeHtml(product.category.toUpperCase())}</small><strong>${window.escapeHtml(product.title)}</strong><i></i><span>AUTOR ANÔNIMO</span>`;
    const preco =
      product.promoPriceCents && product.promoPriceCents < product.priceCents
        ? `<span class="promo-antigo">${money(product.priceCents / 100)}</span><span class="promo-preco">${money(product.promoPriceCents / 100)}</span>`
        : money(product.priceCents / 100);
    return `
    <article class="book-card" tabindex="0" role="button">
      <div class="book-stage"><div class="book-cover ${window.escapeHtml(product.color || "book-navy")} ${product.coverKind === "image" ? "has-photo" : ""}">${cover}</div></div>
      <p class="book-category">${window.escapeHtml(product.category)}</p><h3>${window.escapeHtml(product.title)}</h3><p class="book-author">Autor anônimo</p>
      <div class="price-row"><b>${preco}</b><a class="learn-more" href="livro.html?livro=${encodeURIComponent(product.slug)}">Saiba mais</a><button data-slug="${window.escapeHtml(product.slug)}" data-add-catalogo>Adicionar +</button></div>
    </article>`;
  }

  function abrirDetalhe(slug) {
    // detalhe no padrão do site
    location.href = `livro.html?livro=${encodeURIComponent(slug)}`;
  }

  function aplicarCores(product) {
    return {
      ...product,
      color: ["book-navy", "book-red", "book-sand", "book-green", "book-orange"][
        product.slug.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) % 5
      ],
    };
  }

  async function carregar({ reset = false } = {}) {
    if (reset) pagina = 1;
    const q = inputQ.value.trim();
    const consulta = `page=${pagina}${q ? `&q=${encodeURIComponent(q)}` : ""}${selCategoria.value ? `&category=${encodeURIComponent(selCategoria.value)}` : ""}${selColecao.value ? `&collection=${encodeURIComponent(selColecao.value)}` : ""}${chkNovidades.checked ? "&novidades=1" : ""}`;
    for (const base of apiCandidates) {
      try {
        const response = await fetch(`${base}/catalog?${consulta}`);
        if (!response.ok) continue;
        apiBase = base;
        const { products, meta } = await response.json();
        products.forEach((p) => porSlug.set(p.slug, p));
        const cards = products
          .map(aplicarCores)
          .map((product) => cardHtml(base, product))
          .join("");
        if (reset)
          grid.innerHTML =
            cards || `<p class="catalogo-vazio">${uiText("semResultados", "Nenhum livro encontrado.")}</p>`;
        else grid.insertAdjacentHTML("beforeend", cards);
        mais.hidden = meta.page >= meta.pages;
        preencherFiltros(products);
        return;
      } catch {
        // tenta a próxima origem
      }
    }
    grid.innerHTML = `<p class="catalogo-vazio">${uiText("semResultados", "Nenhum livro encontrado.")}</p>`;
  }

  let filtrosPreenchidos = false;
  function preencherFiltros(products) {
    if (filtrosPreenchidos && selCategoria.options.length > 1) return;
    const categorias = [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b, "pt"));
    const colecoes = [...new Set(products.map((p) => p.collection).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt"),
    );
    const catSel = selCategoria.value;
    const colSel = selColecao.value;
    selCategoria.innerHTML =
      `<option value="">${uiText("filtroCategoria", "Todas as categorias")}</option>` +
      categorias
        .map((c) => `<option${c === catSel ? " selected" : ""}>${window.escapeHtml(c)}</option>`)
        .join("");
    selColecao.innerHTML =
      `<option value="">${uiText("filtroColecao", "Todas as coleções")}</option>` +
      colecoes
        .map((c) => `<option${c === colSel ? " selected" : ""}>${window.escapeHtml(c)}</option>`)
        .join("");
    filtrosPreenchidos = true;
  }

  // Seções da home estilo LOM dentro do catálogo: mais vendidos do mês
  async function carregarMaisVendidos() {
    for (const base of apiCandidates) {
      try {
        const response = await fetch(`${base}/products/mais-vendidos`);
        if (!response.ok) continue;
        const { products } = await response.json();
        if (!products.length) return; // seção fica oculta
        const secao = document.querySelector("#secao-mais-vendidos");
        secao.hidden = false;
        document.querySelector("#grid-mais-vendidos").innerHTML = products
          .map(aplicarCores)
          .map((product) => {
            const cover =
              product.coverKind === "image"
                ? `<img class="cover-photo" src="${base}/products/${encodeURIComponent(product.slug)}/cover" alt="Capa: ${window.escapeHtml(product.title)}">`
                : `<small>NASCENTE / ${window.escapeHtml(product.category.toUpperCase())}</small><strong>${window.escapeHtml(product.title)}</strong><i></i><span>AUTOR ANÔNIMO</span>`;
            return `
            <article class="book-card" tabindex="0" role="button">
              <div class="book-stage"><div class="book-cover ${window.escapeHtml(product.color || "book-navy")} ${product.coverKind === "image" ? "has-photo" : ""}">${cover}</div></div>
              <p class="book-category">${window.escapeHtml(product.category)}</p><h3>${window.escapeHtml(product.title)}</h3><p class="book-author">Autor anônimo</p>
              <div class="price-row"><b>${money(product.priceCents / 100)}</b><a class="learn-more" href="livro.html?livro=${encodeURIComponent(product.slug)}">Saiba mais</a></div>
            </article>`;
          })
          .join("");
        return;
      } catch {
        // próxima origem
      }
    }
  }

  // PDF do catálogo corrente: mostra o link se publicado
  async function verificarPdfCatalogo() {
    for (const base of apiCandidates) {
      try {
        const response = await fetch(`${base}/catalog/pdf`, { method: "HEAD" });
        if (response.ok) {
          const link = document.querySelector("#catalogo-pdf-link");
          link.hidden = false;
          link.href = `${base}/catalog/pdf`;
          return;
        }
      } catch {
        // próxima origem
      }
    }
  }

  inputQ.addEventListener("keydown", (event) => {
    if (event.key === "Enter") carregar({ reset: true });
  });
  document.querySelector("#catalogo-buscar").addEventListener("click", () => carregar({ reset: true }));
  selCategoria.addEventListener("change", () => carregar({ reset: true }));
  selColecao.addEventListener("change", () => carregar({ reset: true }));
  chkNovidades.addEventListener("change", () => carregar({ reset: true }));
  mais.addEventListener("click", () => {
    pagina += 1;
    void carregar();
  });

  // Carrinho: reutiliza o carrinho da index (localStorage compartilhado)
  function getCarrinho() {
    try {
      return JSON.parse(localStorage.getItem("nascente-cart") || "{}");
    } catch {
      return {};
    }
  }
  grid.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-catalogo]");
    if (add) {
      const product = porSlug.get(add.dataset.slug);
      if (!product) return;
      const carrinho = getCarrinho();
      const atual = carrinho[product.title] || {};
      carrinho[product.title] = {
        title: product.title,
        category: product.category,
        price: product.promoPriceCents ?? product.priceCents / 100,
        priceCents: product.priceCents,
        color: ["book-navy", "book-red", "book-sand", "book-green", "book-orange"][
          product.slug.split("").reduce((s2, ch) => s2 + ch.charCodeAt(0), 0) % 5
        ],
        slug: product.slug,
        quantity: (atual.quantity || 0) + 1,
      };
      localStorage.setItem("nascente-cart", JSON.stringify(carrinho));
      add.textContent = "Adicionado ✓";
      setTimeout(() => {
        add.textContent = "Adicionar +";
      }, 1500);
      window.dispatchEvent(new CustomEvent("nascente:carrinho-mudou"));
      return;
    }
    const card = event.target.closest(".book-card");
    if (card && !event.target.closest("a") && !event.target.closest("button")) {
      const slug = card.querySelector("[data-slug]")?.dataset.slug;
      if (slug) abrirDetalhe(slug);
    }
  });

  void carregar({ reset: true });
  void carregarMaisVendidos();
  void verificarPdfCatalogo();
})();
