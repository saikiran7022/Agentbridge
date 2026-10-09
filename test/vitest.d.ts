import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    dbReady: boolean;
  }
}
