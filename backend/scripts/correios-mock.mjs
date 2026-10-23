// Simulador da API dos Correios para desenvolvimento/testes locais.
// Uso: node scripts/correios-mock.mjs  (escuta em 127.0.0.1:4500)
import { createServer } from "node:http";

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/shipping/quote") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.headers.authorization !== "Bearer mock-secret") {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          options: [
            { service: "SEDEX", priceCents: 3900, deadlineDays: 2 },
            { service: "PAC", priceCents: 1970, deadlineDays: 9 },
          ],
        }),
      );
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(4500, "127.0.0.1", () => console.log("[correios-mock] simulador em http://127.0.0.1:4500"));
