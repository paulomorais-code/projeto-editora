import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter });

const products = [
  {
    slug: "a-vida-em-goias",
    collection: "Catálogo inaugural",
    featured: true,
    promoPriceCents: 6800,
    context: "A ideia nasceu de uma série de cadernos escritos durante viagens pelo interior de Goiás. O projeto editorial parte do desejo de olhar para o estado sem folclorizá-lo: reunir paisagem, memória e experiência cotidiana em uma narrativa sobre o que significa permanecer, partir e voltar.",
    title: "A vida em Goiás",
    category: "Goiás",
    description: "Uma escrita sobre pertencimento, memória e deslocamento.",
    priceCents: 7800,
    weightGrams: 280,
    stock: 0
  },
  {
    slug: "brasilia-da-capital-do-progresso-a-capital-da-ordem",
    collection: "Catálogo inaugural",
    featured: true,
    context: "A obra investiga a transformação de Brasília, das promessas modernistas de desenvolvimento ao ordenamento político e espacial que passou a organizar a capital. O projeto nasceu do desejo de ler a cidade como experiência histórica e disputa de futuros.",
    title: "Brasília: da capital do progresso à capital da ordem",
    category: "Brasília",
    description: "Uma leitura crítica da transformação da capital.",
    priceCents: 6400,
    weightGrams: 340,
    stock: 0
  },
  {
    slug: "cadernos-do-mundo-2027",
    collection: "Catálogo inaugural",
    featured: true,
    context: "O projeto parte da necessidade de imaginar 2027 a partir dos países periféricos, recusando previsões produzidas apenas pelos centros econômicos. São cadernos de observação, hipótese e disputa sobre os futuros possíveis.",
    title: "Cadernos do mundo 2027 para países periféricos",
    category: "Mundo",
    description: "Ensaios sobre os futuros dos países periféricos.",
    priceCents: 7200,
    weightGrams: 310,
    stock: 0,
  },
  {
    slug: "goiania-desgoianizacao-do-lucro-a-estagnacao",
    title: "Goiânia: desgoianização do lucro à estagnação",
    category: "Goiânia",
    description:
      "Ensaios sobre a economia de Goiânia e Goiás: a desgoianização do lucro como produto da desnacionalização da economia, a verticalização e concentração dos processos econômicos e seus efeitos sobre goianos e goianas — da fundação da capital em 1933 às grandes mudanças constatadas em 2023.",
    context:
      "Texto elaborado a partir do livro MEMÓRIAS de Pedro Ludovico (pág. 79), ligando a história da fundação de Goiânia ao diagnóstico econômico do presente.",
    priceCents: 4900,
    year: 2023,
    weightGrams: 300,
    stock: 5,
  },
  {
    slug: "cadernos-do-mundo-2024-numero-1",
    title: "Cadernos do Mundo 2024 — Número 1",
    category: "Mundo",
    description:
      "Primeiro número dos Cadernos do Mundo: por que o preço do urânio do Níger saltou de € 0,80/kg para € 200/kg — recursos naturais, poder e a perspectiva dos países periféricos.",
    context: "Série Cadernos do Mundo: observação, hipótese e disputa sobre os futuros possíveis vistos das periferias.",
    priceCents: 3990,
    year: 2024,
    weightGrams: 280,
    stock: 5,
  },
];

for (const product of products) {
  await prisma.product.upsert({
    where: { slug: product.slug },
    update: product,
    create: product
  });
}

await prisma.$disconnect();
