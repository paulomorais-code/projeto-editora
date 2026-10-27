// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * ESLint plano: backend TS + frontend JS (sem build) + scripts.
 * Foco: segurança (innerHTML/as any/eval) e erros reais. Estilo fica com o Prettier.
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "backend/dist/**",
      "backend/src/generated/**",
      "backend/uploads/**",
      "backend/prisma/migrations/**",
      "prototipo/**",
      "**/*.log"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["backend/src/**/*.ts", "backend/scripts/**/*.mjs"]
  })),
  {
    files: ["backend/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "error"
    }
  },
  {
    // Frontend (vanilla, sem TypeScript): bloqueia padrões inseguros conhecidos.
    files: ["site/assets/js/**/*.js", "backend/src/modules/admin/admin.js"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      // innerHTML é permitido somente com escapeHtml() — revisão manual; warn para não travar CI
      // em templates já escapados, mas mantém o ponto na régua.
      "no-restricted-syntax": [
        "warn",
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: "innerHTML exige window.escapeHtml() em todo dado dinâmico (ver AGENTS.md §5.5)."
        }
      ]
    }
  },
  {
    rules: {
      "no-undef": "off" // globals de browser/node variam por arquivo; erros reais já são cobertos acima
    }
  }
];
