export class ServiceNotFoundError extends Error {
  constructor(entityName: string) {
    super(`${entityName} nao encontrado.`);
    this.name = "ServiceNotFoundError";
  }
}

export function getSafeServiceErrorMessage(error: unknown): string {
  if (error instanceof ServiceNotFoundError) return error.message;
  return "Nao foi possivel concluir a operacao solicitada.";
}
