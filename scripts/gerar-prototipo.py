#!/usr/bin/env python3
"""Gera a pasta `prototipo/` — frontend estático com API simulada para o Netlify.

O protótipo permite ao cliente ver TODAS as mudanças visuais (catálogo corrente,
filtros, novidades, destaques, capas, PDF) sem precisar do backend:
- `api-mock/` responde os endpoints usados pelo front (JSON estático + capas PNG)
- `mock-config.js` aponta NASCENTE_API_URL para api-mock e simula o checkout
- Checkout no protótipo: pedido "criado" com dados de demonstração; pagamento
  mostra aviso de indisponível (não há Mercado Pago num site estático)

Uso: python3 scripts/gerar-prototipo.py   (roda na raiz do repositório)
Depois: arraste a pasta prototipo/ em https://app.netlify.com/drop
"""
import json
import os
import shutil
import struct
import zlib
from datetime import datetime, timedelta, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, "prototipo")
HOJE = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

LIVROS = [
    {
        "slug": "a-vida-em-goias",
        "title": "A vida em Goiás",
        "category": "Goiás",
        "collection": "Catálogo inaugural",
        "description": "Uma escrita sobre pertencimento, memória e deslocamento.",
        "context": "A ideia nasceu de uma série de cadernos escritos durante viagens pelo interior de Goiás.",
        "priceCents": 7800,
        "promoPriceCents": 6800,
        "pages": 160,
        "year": 2024,
        "featured": True,
        "weightGrams": 280,
        "stock": 5,
        "coverKind": "image",
        "createdAt": HOJE,
    },
    {
        "slug": "brasilia-da-capital-do-progresso-a-capital-da-ordem",
        "title": "Brasília: da capital do progresso à capital da ordem",
        "category": "Brasília",
        "collection": "Catálogo inaugural",
        "description": "Uma leitura crítica da transformação da capital.",
        "context": "O projeto nasceu do desejo de ler a cidade como experiência histórica e disputa de futuros.",
        "priceCents": 6400,
        "promoPriceCents": None,
        "pages": 180,
        "year": 2024,
        "featured": True,
        "weightGrams": 340,
        "stock": 5,
        "coverKind": "image",
        "createdAt": HOJE,
    },
    {
        "slug": "cadernos-do-mundo-2027",
        "title": "Cadernos do mundo 2027 para países periféricos",
        "category": "Mundo",
        "collection": "Catálogo inaugural",
        "description": "Ensaios sobre os futuros dos países periféricos.",
        "context": "Cadernos de observação, hipótese e disputa sobre os futuros possíveis.",
        "priceCents": 7200,
        "promoPriceCents": None,
        "pages": 200,
        "year": 2024,
        "featured": True,
        "weightGrams": 310,
        "stock": 5,
        "coverKind": "image",
        "createdAt": (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    },
    {
        "slug": "novo-lançamento-exemplo",
        "title": "Novo lançamento (exemplo)",
        "category": "Mundo",
        "collection": "Novidades",
        "description": "Livro de exemplo para demonstrar as novidades do catálogo corrente.",
        "context": "Criado apenas como demonstração do protótipo.",
        "priceCents": 5900,
        "promoPriceCents": None,
        "pages": 128,
        "year": 2026,
        "featured": False,
        "weightGrams": 250,
        "stock": 10,
        "coverKind": "image",
        "createdAt": HOJE,
    },
]

CORES = {
    "a-vida-em-goias": ((25, 46, 61), (120, 30, 25)),
    "brasilia-da-capital-do-progresso-a-capital-da-ordem": ((172, 52, 46), (60, 30, 40)),
    "cadernos-do-mundo-2027": ((75, 93, 69), (20, 30, 45)),
    "novo-lançamento-exemplo": ((40, 80, 120), (150, 90, 30)),
}


def png_gradiente(caminho, w=360, h=540, c1=(25, 46, 61), c2=(140, 40, 35)):
    linhas = b""
    for y in range(h):
        linha = b"\x00"
        for x in range(w):
            t = (x / w + y / h) / 2
            linha += bytes(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
        linhas += linha

    def chunk(tipo, dados):
        c = tipo + dados
        return struct.pack(">I", len(dados)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(linhas, 6))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "wb") as f:
        f.write(png)


def pdf_catalogo(caminho, livros):
    linhas = []
    y = 760
    linhas.append("BT /F1 22 Tf 50 800 Td (Nascente - Catalogo corrente) Tj ET")
    for livro in livros:
        preco = f"R$ {(livro['promoPriceCents'] or livro['priceCents']) / 100:.2f}".replace(".", ",")
        titulo = livro["title"][:60]
        linhas.append(f"BT /F1 12 Tf 50 {y} Td ({titulo}) Tj ET")
        linhas.append(f"BT /F1 10 Tf 380 {y} Td ({preco}) Tj ET")
        y -= 26
    conteudo = "\n".join(linhas)
    objetos = [
        "<</Type/Catalog/Pages 2 0 R>>",
        "<</Type/Pages/Kids[3 0 R]/Count 1>>",
        f"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
        f"<</Length {len(conteudo)}>>stream\n{conteudo}\nendstream",
        "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    pdf = "%PDF-1.4\n"
    refs = []
    for i, corpo in enumerate(objetos, start=1):
        refs.append(f"{i} 0 obj\n{corpo}\nendobj\n")
    pdf += "".join(refs)
    pdf += f"trailer<</Size {len(objetos) + 1}/Root 1 0 R>>\n%%EOF"
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "w", encoding="latin-1", errors="replace") as f:
        f.write(pdf)


MOCK_CONFIG = """// PROTOTÓTIPO: aponta o front para a API simulada e simula checkout/pedidos.
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
    const url = String(input instanceof Request ? input.url : input);
    const metodo = (init?.method || "GET").toUpperCase();
    if (url.includes("/orders") && metodo === "POST") {
      return json({ order: { ...DEMO, accessToken: "token-de-demostracao" } }, 201);
    }
    if (url.includes("/orders/") && metodo === "GET") {
      return json({ order: DEMO });
    }
    if (url.includes("payment-preference")) {
      return json({ error: "Protótipo — pagamento não disponível nesta demonstração." }, 503);
    }
    if (url.includes("/catalog/pdf")) {
      if (metodo === "HEAD") return new Response(null, { status: 200 });
      const pdf = await fetchReal("api-mock/catalogo-corrente.pdf");
      return new Response(await pdf.arrayBuffer(), { status: 200, headers: { "content-type": "application/pdf" } });
    }
    return fetchReal(input, init);
  };
})();
"""

PAGINAS = ["index.html", "catalogo.html", "livro.html", "pedido.html", "pagamento/sucesso/index.html", "pagamento/falha/index.html", "pagamento/pendente/index.html"]


def principal():
    if os.path.exists(DESTINO):
        shutil.rmtree(DESTINO)
    os.makedirs(DESTINO)

    # 1) copia páginas + assets
    for pagina in PAGINAS:
        src = os.path.join(RAIZ, pagina)
        dst = os.path.join(DESTINO, pagina)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
    shutil.copytree(os.path.join(RAIZ, "assets"), os.path.join(DESTINO, "assets"))

    # 2) injeta mock-config como primeiro script em cada página
    for pagina in PAGINAS:
        caminho = os.path.join(DESTINO, pagina)
        with open(caminho, encoding="utf-8") as f:
            html = f.read()
        # cache-busting: nova versão a cada geração
        versao = "prototipo-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        html = html.replace("?v=20261022", f"?v={versao}")
        primeiro = html.index("<script src=")
        html = html[:primeiro] + f'<script src="assets/js/mock-config.js?v={versao}"></script>\n    ' + html[primeiro:]
        with open(caminho, "w", encoding="utf-8") as f:
            f.write(html)

    # 3) mock-config
    with open(os.path.join(DESTINO, "assets", "js", "mock-config.js"), "w", encoding="utf-8") as f:
        f.write(MOCK_CONFIG)

    # 4) api-mock
    api = os.path.join(DESTINO, "api-mock")
    os.makedirs(api, exist_ok=True)
    with open(os.path.join(api, "products.json"), "w", encoding="utf-8") as f:
        json.dump({"products": LIVROS}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(api, "catalog"), "w", encoding="utf-8") as f:
        json.dump({"products": LIVROS, "meta": {"page": 1, "pages": 1, "total": len(LIVROS)}}, f, ensure_ascii=False, indent=1)
    os.makedirs(os.path.join(api, "home"), exist_ok=True)
    with open(os.path.join(api, "home", "sections"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "novidades": LIVROS,
                "destaques": [l for l in LIVROS if l["featured"]],
                "maisVendidos": [
                    {**LIVROS[0], "unidades": 7},
                    {**LIVROS[2], "unidades": 4},
                ],
            },
            f,
            ensure_ascii=False,
            indent=1,
        )
    # mais vendidos (GET /api/products/mais-vendidos)
    os.makedirs(os.path.join(api, "products"), exist_ok=True)
    with open(os.path.join(api, "products", "mais-vendidos"), "w", encoding="utf-8") as f:
        json.dump({"products": [{**LIVROS[0], "unidades": 7}, {**LIVROS[2], "unidades": 4}]}, f, ensure_ascii=False, indent=1)

    # pedido de demonstração (GET /api/orders/demo-pedido-01)
    with open(os.path.join(api, "orders-demo"), "w", encoding="utf-8") as f:
        json.dump({"order": {"id": "demo-pedido-01"}}, f)

    # 5) capas placeholder
    for livro in LIVROS:
        c1, c2 = CORES.get(livro["slug"], ((30, 40, 60), (120, 60, 30)))
        png_gradiente(os.path.join(api, "products", livro["slug"], "cover"), 360, 540, c1, c2)

    # 6) catálogo corrente em PDF
    pdf_catalogo(os.path.join(api, "catalogo-corrente.pdf"), LIVROS)

    total = sum(len(files) for _, _, files in os.walk(DESTINO))
    print(f"prototipo/ gerado: {total} arquivos")
    print("Publicar: arraste a pasta em https://app.netlify.com/drop  (ou: netlify deploy --dir=prototipo)")


if __name__ == "__main__":
    principal()
