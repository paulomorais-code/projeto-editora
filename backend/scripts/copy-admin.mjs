import { cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Copia os assets estáticos do painel admin para dist/ (o tsc só compila .ts).
// NÃO remove o diretório: dist/modules/admin também contém admin.routes.js compilado.
const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "..", "src", "modules", "admin");
const dest = join(root, "..", "dist", "modules", "admin");

mkdirSync(dest, { recursive: true });
cpSync(join(src, "admin.html"), join(dest, "admin.html"));
cpSync(join(src, "admin.js"), join(dest, "admin.js"));
console.log("[copy-admin] admin assets copiados para dist/modules/admin");
