import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listProducts, findProductCover } from "./catalog.service.js";

export async function catalogRoutes(app: FastifyInstance) {
  app.get("/products", async () => ({ products: await listProducts() }));

  // Capa pública: serve o arquivo com mime da whitelist e cache longo (nome tem hash do conteúdo).
  app.get("/products/:slug/cover", async (request, reply) => {
    const parsed = z.object({ slug: z.string().max(120) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SLUG" });
    const cover = await findProductCover(parsed.data.slug);
    if (!cover) return reply.code(404).send({ error: "COVER_NOT_FOUND" });
    const body = await readFile(cover.path);
    return (
      reply
        .code(200)
        .header("content-type", cover.mime)
        .header("cache-control", "public, max-age=2592000, immutable")
        .header("x-content-type-options", "nosniff")
        // A capa é embedada cross-origin pelo site estático (CORP same-origin do helmet bloquearia).
        .header("cross-origin-resource-policy", "cross-origin")
        .send(body)
    );
  });
}
