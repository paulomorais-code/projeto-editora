/**
 * Erro de aplicação com código estável e status HTTP.
 * Handler global em app.ts converte para `{ error: code }` sem vazar detalhes.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "AppError";
  }
}
