import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listCatalog,
  listProducts,
  listByFlags,
  maisSolicitados,
  findProductCover,
} from "./catalog.service.js";
import { catalogPdfPath, catalogPdfMime } from "../../lib/catalog-pdf.js";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(100).optional(),
  collection: z.string().trim().max(100).optional(),
  novidades: z.enum(["1", "0"]).optional(),
  featured: z.enum(["1", "0"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
});

export async function catalogRoutes(app: FastifyInstance) {
  // Lista completa (compatível com a vitrine atual da index)
  app.get("/products", async () => ({ products: await listProducts() }));

  // Catálogo corrente: busca, filtros, novidades, destaques e paginação
  app.get("/catalog", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const result = await listCatalog({
      q: parsed.data.q,
      category: parsed.data.category,
      collection: parsed.data.collection,
      novidades: parsed.data.novidades === "1",
      featured: parsed.data.featured === "1",
      page: parsed.data.page ?? 1,
    });
    return result;
  });

  app.get("/products/mais-vendidos", async () => ({ products: await maisSolicitados() }));

  app.get("/home/sections", async () => ({
    novidades: await listByFlags({ novidades: true, take: 8 }),
    destaques: await listByFlags({ featured: true, take: 8 }),
    maisVendidos: await maisSolicitados(),
  }));

  // Capa pública: mime da whitelist + cache longo (nome tem hash do conteúdo)
  app.get("/products/:slug/cover", async (request, reply) => {
    const parsed = z.object({ slug: z.string().max(120) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SLUG" });
    const cover = await findProductCover(parsed.data.slug);
    if (!cover) return reply.code(404).send({ error: "COVER_NOT_FOUND" });
    const body = await readFile(cover.path);
    return reply
      .code(200)
      .header("content-type", cover.mime)
      .header("cache-control", "public, max-age=2592000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "cross-origin")
      .send(body);
  });

  // Catálogo corrente em PDF (publicado pelo editor no painel)
  app.get("/catalog/pdf", async (_request, reply) => {
    const path = catalogPdfPath();
    if (!path) return reply.code(404).send({ error: "CATALOG_PDF_NOT_FOUND" });
    const body = await readFile(path);
    return reply
      .code(200)
      .header("content-type", catalogPdfMime())
      .header("content-disposition", 'inline; filename="catalogo-nascente.pdf"')
      .header("x-content-type-options", "nosniff")
      .send(body);
  });
}
