import { prisma } from "../../lib/prisma.js";
import { coverFilePath, isAllowedCoverMime } from "../../lib/covers.js";

export const PAGE_SIZE = 12;
const NOVIDADES_DIAS = 90;

const productSelect = {
  slug: true,
  title: true,
  category: true,
  collection: true,
  description: true,
  context: true,
  priceCents: true,
  promoPriceCents: true,
  pages: true,
  year: true,
  featured: true,
  weightGrams: true,
  stock: true,
  coverMime: true,
  createdAt: true,
} as const;

function paraVitrine(products: Array<Record<string, unknown>> & Array<{ coverMime: string | null }>) {
  return products.map(({ coverMime, ...product }) => ({
    ...product,
    coverKind: coverMime === "application/pdf" ? "pdf" : coverMime ? "image" : null,
  }));
}

/**
 * Lista para a vitrine da home: todos os ativos, mais antigos primeiro (comportamento
 * original da index). Mantida para compatibilidade com cart.js.
 */
export async function listProducts() {
  const products = await prisma.product.findMany({
    where: { active: true },
    select: productSelect,
    orderBy: { createdAt: "asc" },
  });
  return paraVitrine(products as never);
}

/**
 * Catálogo corrente (estilo LOM): busca, filtros, novidades, destaques e paginação.
 */
export async function listCatalog(params: {
  q?: string;
  category?: string;
  collection?: string;
  novidades?: boolean;
  featured?: boolean;
  page: number;
}) {
  const cutoff = new Date(Date.now() - NOVIDADES_DIAS * 24 * 60 * 60 * 1000);
  const where = {
    active: true,
    // Busca sem acento: o slug é ASCII, então "brasilia" encontra "Brasília".
    ...(params.q
      ? {
          OR: [
            { title: { contains: params.q, mode: "insensitive" as const } },
            { slug: { contains: params.q } },
          ],
        }
      : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.collection ? { collection: params.collection } : {}),
    ...(params.novidades ? { createdAt: { gte: cutoff } } : {}),
    ...(params.featured ? { featured: true } : {}),
  };
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: productSelect,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return {
    products: paraVitrine(products as never),
    meta: { page: params.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total },
  };
}

/** Livros de uma coleção/categoria para seções da home. */
export async function listByFlags(options: { novidades?: boolean; featured?: boolean; take?: number }) {
  const cutoff = new Date(Date.now() - NOVIDADES_DIAS * 24 * 60 * 60 * 1000);
  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(options.novidades ? { createdAt: { gte: cutoff } } : {}),
      ...(options.featured ? { featured: true } : {}),
    },
    select: productSelect,
    orderBy: { createdAt: "desc" },
    take: options.take ?? 8,
  });
  return paraVitrine(products as never);
}

/** Os mais solicitados do mês: unidades de pedidos APROVADOS nos últimos 30 dias. */
export async function maisSolicitados(take = 10) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const items = await prisma.orderItem.findMany({
    where: { order: { paymentStatus: "APPROVED", createdAt: { gte: cutoff } } },
    include: { product: { select: productSelect } },
  });
  const contagem = new Map<string, { product: (typeof items)[number]["product"]; unidades: number }>();
  for (const item of items) {
    const atual = contagem.get(item.productId) ?? { product: item.product, unidades: 0 };
    atual.unidades += item.quantity;
    contagem.set(item.productId, atual);
  }
  return [...contagem.values()]
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, take)
    .map(({ product, unidades }) => ({ ...paraVitrine([product as never])[0], unidades }));
}

export async function findProductCover(slug: string): Promise<{ path: string; mime: string } | null> {
  const product = await prisma.product.findUnique({
    where: { slug },
    select: { coverFile: true, coverMime: true },
  });
  if (!product?.coverFile || !product.coverMime || !isAllowedCoverMime(product.coverMime)) return null;
  const path = coverFilePath(product.coverFile);
  return path ? { path, mime: product.coverMime } : null;
}
