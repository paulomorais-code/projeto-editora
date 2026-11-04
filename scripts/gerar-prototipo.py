#!/usr/bin/env python3
"""Gera a pasta `prototipo/` — snapshot estático do catálogo atual para o Netlify.

O protótipo permite ao cliente ver TODAS as mudanças visuais sem backend:
- `api-mock/` espelha os endpoints usados pelo front (JSON + capas reais)
- `mock-config.js` aponta NASCENTE_API_URL para api-mock e simula o checkout
- Checkout no protótipo: pedido "criado" com dados de demonstração; pagamento
  mostra aviso de indisponível (não há Mercado Pago num site estático)

PRÉ-REQUISITO: a API deve estar rodando (bash backend/scripts/dev-up.sh),
pois o snapshot vem dela: python3 scripts/gerar-prototipo.py
"""
import json
import os
import shutil
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONT = os.path.join(RAIZ, "site")
DESTINO = os.path.join(RAIZ, "prototipo")
API = "http://localhost:3333/api"

PAGINAS = [
    "index.html",
    "catalogo.html",
    "livro.html",
    "pedido.html",
    "pagamento/sucesso/index.html",
    "pagamento/falha/index.html",
    "pagamento/pendente/index.html",
]

MOCK_CONFIG = """// PROTOTÓTIPO: aponta o front para a API simulada (arquivos em /api-mock) e simula checkout.
window.NASCENTE_API_URL = "api-mock";
(function () {
  const fetchReal = window.fetch.bind(window);
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const DEMO = {
    id: "demo-pedido-01",
    status: "PENDING",
    paymentStatus: "PENDING",
    totalCents: 14600,
    shippingCents: 0,
    shippingMethod: null,
    trackingCode: "BR000000000BR",
    createdAt: new Date().toISOString(),
    items: [
      { title: "A vida em Goiás", unitCents: 6800, quantity: 1 },
      { title: "Cadernos do mundo 2027 para países periféricos", unitCents: 7200, quantity: 1 },
    ],
  };
  window.fetch = async (input, init) => {
    const urlSemQuery = String(input instanceof Request ? input.url : input).split("?")[0];
    const metodo = (init?.method || "GET").toUpperCase();
    if (urlSemQuery.includes("/orders") && metodo === "POST") {
      return json({ order: { ...DEMO, accessToken: "token-de-demostracao" } }, 201);
    }
    if (urlSemQuery.includes("/orders/") && metodo === "GET") {
      return json({ order: DEMO });
    }
    if (urlSemQuery.includes("payment-preference")) {
      return json({ error: "Protótipo — pagamento não disponível nesta demonstração." }, 503);
    }
    if (urlSemQuery.includes("/catalog/pdf")) {
      if (metodo === "HEAD") return new Response(null, { status: 200 });
      const pdf = await fetchReal("/api-mock/catalogo-corrente.pdf");
      return new Response(await pdf.arrayBuffer(), { status: 200, headers: { "content-type": "application/pdf" } });
    }
    if (urlSemQuery.includes("/products/mais-vendidos")) {
      return json(await (await fetchReal("/api-mock/data/mais-vendidos.json")).json());
    }
    if (urlSemQuery.endsWith("/products")) {
      return json(await (await fetchReal("/api-mock/data/products.json")).json());
    }
    return fetchReal(input, init);
  };
})();
"""


def buscar(caminho):
    with urllib.request.urlopen(API + caminho, timeout=8) as resposta:
        return json.load(resposta)


def baixar(caminho, destino):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with urllib.request.urlopen(API + caminho, timeout=15) as resposta, open(destino, "wb") as f:
        f.write(resposta.read())


def principal():
    produtos = buscar("/products")["products"]
    mais_vendidos = buscar("/products/mais-vendidos")["products"]
    catalogo = {"products": produtos, "meta": {"page": 1, "pages": 1, "total": len(produtos)}}
    destaques = [p for p in produtos if p.get("featured")]

    if os.path.exists(DESTINO):
        shutil.rmtree(DESTINO)
    os.makedirs(DESTINO)

    # 1) páginas + assets do front
    for pagina in PAGINAS:
        destino = os.path.join(DESTINO, pagina)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        shutil.copy2(os.path.join(FRONT, pagina), destino)
    shutil.copytree(os.path.join(FRONT, "assets"), os.path.join(DESTINO, "assets"))

    # 2) mock-config como primeiro script (com cache-busting próprio)
    versao = "prototipo"
    with open(os.path.join(DESTINO, "assets", "js", "mock-config.js"), "w", encoding="utf-8") as f:
        f.write(MOCK_CONFIG)
    for pagina in PAGINAS:
        caminho = os.path.join(DESTINO, pagina)
        with open(caminho, encoding="utf-8") as f:
            html = f.read()
        primeiro = html.index("<script src=")
        html = html[:primeiro] + f'<script src="assets/js/mock-config.js?v={versao}"></script>\n    ' + html[primeiro:]
        with open(caminho, "w", encoding="utf-8") as f:
            f.write(html)

    # 3) api-mock: dados reais do catálogo
    api = os.path.join(DESTINO, "api-mock")
    os.makedirs(api, exist_ok=True)
    os.makedirs(os.path.join(api, "data"), exist_ok=True)
    with open(os.path.join(api, "data", "products.json"), "w", encoding="utf-8") as f:
        json.dump({"products": produtos}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(api, "catalog"), "w", encoding="utf-8") as f:
        json.dump(catalogo, f, ensure_ascii=False, indent=1)
    with open(os.path.join(api, "data", "mais-vendidos.json"), "w", encoding="utf-8") as f:
        json.dump({"products": mais_vendidos}, f, ensure_ascii=False, indent=1)
    os.makedirs(os.path.join(api, "home"), exist_ok=True)
    with open(os.path.join(api, "home", "sections"), "w", encoding="utf-8") as f:
        json.dump(
            {"novidades": produtos, "destaques": destaques, "maisVendidos": mais_vendidos},
            f,
            ensure_ascii=False,
            indent=1,
        )

    # 4) capas reais (arquivos estáticos servidos pelo próprio mock, por slug)
    for produto in produtos:
        if produto.get("coverKind"):
            baixar(f"/products/{produto['slug']}/cover", os.path.join(api, "products", produto["slug"], "cover"))

    # 5) catálogo corrente em PDF (publicado pelo editor)
    if buscar_pdf_publicado():
        baixar("/catalog/pdf", os.path.join(api, "catalogo-corrente.pdf"))

    total = sum(len(files) for _, _, files in os.walk(DESTINO))
    print(f"prototipo/ gerado: {total} arquivos — {len(produtos)} livros, {len(mais_vendidos)} mais vendidos")
    print("Publicar: arraste a pasta em https://app.netlify.com/drop  (ou: netlify deploy --dir=prototipo)")


def buscar_pdf_publicado():
    try:
        with urllib.request.urlopen(API + "/catalog/pdf", timeout=8) as resposta:
            return resposta.status == 200
    except Exception:
        return False


if __name__ == "__main__":
    principal()
