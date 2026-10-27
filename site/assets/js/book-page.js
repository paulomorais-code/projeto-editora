const catalog = {
  "a-vida-em-goias": {
    title: "A vida em Goiás",
    category: "Literatura e território",
    price: 78,
    color: "book-navy",
    context:
      "A ideia nasceu de uma série de cadernos escritos durante viagens pelo interior de Goiás. O projeto editorial parte do desejo de olhar para o estado sem folclorizá-lo: reunir paisagem, memória e experiência cotidiana em uma narrativa sobre o que significa permanecer, partir e voltar.",
    description:
      "Entre estradas, cidades pequenas e paisagens que guardam muitas camadas de tempo, este livro acompanha uma vida em Goiás sem transformar o território em cenário. A obra investiga pertencimento, memória e deslocamento, reunindo uma escrita atenta às vozes que formam o centro-oeste brasileiro.",
  },
  "brasilia-da-capital-do-progresso-a-capital-da-ordem": {
    title: "Brasília: da capital do progresso à capital da ordem",
    category: "Brasília",
    price: 64,
    color: "book-red",
    context:
      "A obra investiga a transformação de Brasília, das promessas modernistas de desenvolvimento ao ordenamento político e espacial que passou a organizar a capital. O projeto nasceu do desejo de ler a cidade como experiência histórica e disputa de futuros.",
    description:
      "Uma leitura crítica da trajetória de Brasília e das forças que transformaram a capital do progresso em capital da ordem. O livro articula arquitetura, política e vida cotidiana para compreender a cidade para além do monumento.",
  },
  "cadernos-do-mundo-2027": {
    title: "Cadernos do mundo 2027 para países periféricos",
    category: "Mundo",
    price: 72,
    color: "book-sand",
    context:
      "O projeto parte da necessidade de imaginar 2027 a partir dos países periféricos, recusando previsões produzidas apenas pelos centros econômicos. São cadernos de observação, hipótese e disputa sobre os futuros possíveis.",
    description:
      "Uma coleção de ensaios sobre os futuros que se abrem para os países periféricos. Cadernos do mundo 2027 reúne análises e perguntas para pensar soberania, trabalho, tecnologia e dependência.",
  },
};

const slug = new URLSearchParams(window.location.search).get("livro") || "a-vida-em-goias";
// Livro cadastrado depois dos 3 originais: objeto próprio (nunca mutar o fallback alheio).
const book =
  catalog[slug] ||
  (catalog[slug] = {
    title: "",
    category: "Nascente",
    price: 0,
    color: "book-navy",
    description: "",
    context: "",
  });
window.currentBook = book;
window.currentBookSlug = slug;
const money = (value) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function loadRemoteBook() {
  // Mesma cadeia de candidatos do carrinho: mesma origem primeiro, depois localhost:3333.
  const candidates = window.NASCENTE_API_URL
    ? [window.NASCENTE_API_URL]
    : ["/api", "http://localhost:3333/api"];
  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/products`);
      if (!response.ok) continue;
      const remote = (await response.json()).products.find((product) => product.slug === slug);
      if (remote) {
        Object.assign(book, {
          title: remote.title,
          category: remote.category,
          description: remote.description || book.description,
          context: remote.context || book.context || "",
          price: remote.priceCents / 100,
          coverKind: remote.coverKind ?? null,
        });
      }
      if (!book.title) book.title = "Livro";
      document.title = `${book.title} — Nascente`;
      renderCover(base);
      document.querySelector("#detail-title").textContent = book.title;
      document.querySelector("#detail-category").textContent = book.category;
      document.querySelector("#detail-description").textContent = book.description;
      document.querySelector("#detail-price").textContent = money(book.price);
      document.querySelector(".creation-context")?.toggleAttribute("hidden", !book.context);
      return;
    } catch {
      // origem indisponível: tenta a próxima
    }
  }
}

document.title = `${book.title} — Nascente`;
function renderCover(apiBase) {
  const detailCover = document.querySelector("#detail-cover");
  detailCover.classList.add(book.color);
  detailCover.classList.toggle("has-photo", book.coverKind === "image");
  const apiBaseCover =
    apiBase ||
    window.NASCENTE_API_URL ||
    (window.location.protocol === "file:" ? "http://localhost:3333/api" : "/api");
  if (book.coverKind === "image") {
    detailCover.innerHTML = `<img class="cover-photo" src="${apiBaseCover}/products/${encodeURIComponent(slug)}/cover" alt="Capa: ${window.escapeHtml(book.title)}">`;
  } else if (book.coverKind === "pdf") {
    detailCover.innerHTML = `<embed class="cover-pdf" src="${apiBaseCover}/products/${encodeURIComponent(slug)}/cover" type="application/pdf" title="Capa: ${window.escapeHtml(book.title)}">`;
  } else {
    detailCover.innerHTML = `<small>NASCENTE / ${window.escapeHtml(book.category.toUpperCase())}</small><strong>${window.escapeHtml(book.title)}</strong><i></i><span>AUTOR ANÔNIMO</span>`;
  }
}
renderCover();
document.querySelector("#detail-category").textContent = book.category;
document.querySelector("#detail-title").textContent = book.title;
document.querySelector("#detail-description").textContent = book.description;
document.querySelector("#detail-context").textContent = book.context;
document.querySelector(".creation-context")?.toggleAttribute("hidden", !book.context);
document.querySelector("#detail-price").textContent = money(book.price);

document.querySelector("#detail-add").addEventListener("click", () => {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("nascente-cart") || "{}");
  } catch {
    localStorage.removeItem("nascente-cart");
  }
  saved[book.title] = {
    title: book.title,
    category: book.category,
    price: book.price,
    color: book.color,
    quantity: (saved[book.title]?.quantity || 0) + 1,
  };
  localStorage.setItem("nascente-cart", JSON.stringify(saved));
  document.querySelector("#detail-feedback").textContent =
    "Livro adicionado ao carrinho. Você pode continuar explorando o catálogo.";
});

loadRemoteBook();
