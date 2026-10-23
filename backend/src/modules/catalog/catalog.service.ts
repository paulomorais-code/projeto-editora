import { prisma } from "../../lib/prisma.js";
import { coverFilePath, isAllowedCoverMime } from "../../lib/covers.js";

export async function listProducts() {
  const products = await prisma.product.findMany({
    where: { active: true },
    select: {
      slug: true,
      title: true,
      category: true,
      description: true,
      priceCents: true,
      weightGrams: true,
      stock: true,
      coverMime: true,
    },
    orderBy: { createdAt: "asc" },
  });
  // coverKind diz ao frontend como renderizar: imagem, pdf (embed na página do livro) ou capa CSS.
  return products.map(({ coverMime, ...product }) => ({
    ...product,
    coverKind: coverMime === "application/pdf" ? "pdf" : coverMime ? "image" : null,
  }));
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
