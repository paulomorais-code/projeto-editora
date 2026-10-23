import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter });

const products = [
  {
    slug: "a-vida-em-goias",
    title: "A vida em Goiás",
    category: "Goiás",
    description: "Uma escrita sobre pertencimento, memória e deslocamento.",
    priceCents: 7800,
    weightGrams: 280,
    stock: 0
  },
  {
    slug: "brasilia-da-capital-do-progresso-a-capital-da-ordem",
    title: "Brasília: da capital do progresso à capital da ordem",
    category: "Brasília",
    description: "Uma leitura crítica da transformação da capital.",
    priceCents: 6400,
    weightGrams: 340,
    stock: 0
  },
  {
    slug: "cadernos-do-mundo-2027",
    title: "Cadernos do mundo 2027 para países periféricos",
    category: "Mundo",
    description: "Ensaios sobre os futuros dos países periféricos.",
    priceCents: 7200,
    weightGrams: 310,
    stock: 0
  }
];

for (const product of products) {
  await prisma.product.upsert({
    where: { slug: product.slug },
    update: product,
    create: product
  });
}

await prisma.$disconnect();
