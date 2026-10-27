// Seções dinâmicas da home (estilo LOM): Novidades, Destaques, Mais solicitados do mês.
(function () {
  const apiCandidates = window.NASCENTE_API_URL
    ? [window.NASCENTE_API_URL]
    : ["/api", "http://localhost:3333/api"];
  let apiBase = apiCandidates[0];

  function money(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function cor(slug) {
    return ["book-navy", "book-red", "book-sand", "book-green", "book-orange"][
      slug.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) % 5
    ];
  }

  function card(product) {
    const cover =
      product.coverKind === "image"
        ? `<img class="cover-photo" src="${apiBase}/products/${encodeURIComponent(product.slug)}/cover" alt="Capa: ${window.escapeHtml(product.title)}">`
        : `<small>NASCENTE / ${window.escapeHtml(product.category.toUpperCase())}</small><strong>${window.escapeHtml(product.title)}</strong><i></i><span>AUTOR ANÔNIMO</span>`;
    const preco =
      product.promoPriceCents && product.promoPriceCents < product.priceCents
        ? `<span class="promo-antigo">${money(product.priceCents / 100)}</span><span class="promo-preco">${money(product.promoPriceCents / 100)}</span>`
        : money(product.priceCents / 100);
    const unidades = product.unidades ? `<small>${product.unidades} ✓</small>` : "";
    return `
    <article class="book-card" tabindex="0" role="button">
      <div class="book-stage"><div class="book-cover ${cor(product.slug)} ${product.coverKind === "image" ? "has-photo" : ""}">${cover}</div></div>
      <p class="book-category">${window.escapeHtml(product.category)}</p><h3>${window.escapeHtml(product.title)}</h3><p class="book-author">Autor anônimo</p>
      <div class="price-row"><b>${preco}</b>${unidades}<a class="learn-more" href="livro.html?livro=${encodeURIComponent(product.slug)}">Saiba mais</a><button data-add-title="${window.escapeHtml(product.title)}" data-add-slug="${window.escapeHtml(product.slug)}" data-add-price="${product.promoPriceCents ?? product.priceCents}" data-add-categoria="${window.escapeHtml(product.category)}">Adicionar +</button></div>
    </article>`;
  }

  function preencher(containerId, products) {
    const container = document.querySelector(containerId);
    if (!container) return;
    if (!products.length) {
      container.closest(".home-secao, section")?.setAttribute("hidden", "");
      return;
    }
    container.closest(".home-secao, section")?.removeAttribute("hidden");
    container.innerHTML = products.map(card).join("");
    container.querySelectorAll("[data-add-title]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const titulo = button.dataset.addTitle;
        const carrinho = (() => {
          try {
            return JSON.parse(localStorage.getItem("nascente-cart") || "{}");
          } catch {
            return {};
          }
        })();
        const atual = carrinho[titulo] || {};
        carrinho[titulo] = {
          title: titulo,
          category: button.dataset.addCategoria,
          price: Number(button.dataset.addPrice) / 100,
          color: cor(button.dataset.addSlug),
          slug: button.dataset.addSlug,
          quantity: (atual.quantity || 0) + 1,
        };
        localStorage.setItem("nascente-cart", JSON.stringify(carrinho));
        button.textContent = "Adicionado ✓";
        setTimeout(() => {
          button.textContent = "Adicionar +";
        }, 1500);
        document.dispatchEvent(new CustomEvent("nascente:carrinho-mudou"));
      });
    });
    container.querySelectorAll(".book-card").forEach((cardEl) => {
      cardEl.addEventListener("click", (event) => {
        if (event.target.closest("button") || event.target.closest("a")) return;
        const slug = cardEl.querySelector("[data-add-slug]")?.dataset.addSlug;
        if (slug) location.href = `livro.html?livro=${encodeURIComponent(slug)}`;
      });
    });
  }

  async function carregar() {
    for (const base of apiCandidates) {
      try {
        const response = await fetch(`${base}/home/sections`);
        if (!response.ok) continue;
        apiBase = base;
        const { novidades, destaques, maisVendidos } = await response.json();
        preencher("#home-novidades", novidades);
        preencher("#home-destaques", destaques);
        preencher("#home-mais-vendidos", maisVendidos);
        return;
      } catch {
        // tenta a próxima origem
      }
    }
  }

  void carregar();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void carregar();
  });
})();
