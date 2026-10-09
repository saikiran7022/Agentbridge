export class HubError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HubError";
  }
}

export const notFound = (what: string) => new HubError(404, `${what} not found`);
export const forbidden = (why: string) => new HubError(403, why);
export const badRequest = (why: string) => new HubError(400, why);
