// PROTOTÓTIPO: aponta o front para a API simulada (arquivos em /api-mock) e simula checkout.
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
