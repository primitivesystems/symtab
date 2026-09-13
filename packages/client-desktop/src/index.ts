import { WebFluxClient } from "@flux/client-web";
import type { VaultChange } from "@flux/bridge-contract";

export interface DesktopFluxBridge {
  fluxFetch(request: {
    url: string;
    method?: string;
    body?: string;
  }): Promise<{ status: number; body: string; bodyBase64?: string; contentType: string }>;
  watchVaultRevision(
    vaultId: string,
    onRevision: (revision: number) => void,
    onError?: (message: string) => void
  ): () => void;
  watchVaultChanges(
    vaultId: string,
    onChange: (change: VaultChange) => void,
    onError?: (message: string) => void
  ): () => void;
}

export class DesktopFluxClient extends WebFluxClient {
  constructor(private readonly bridge: DesktopFluxBridge) {
    super("/api/v1", async (input, init) => {
      if (typeof input !== "string") throw new TypeError("Desktop bridge requires a string URL");
      const response = await bridge.fluxFetch({
        url: input,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      const body = response.bodyBase64
        ? Uint8Array.from(atob(response.bodyBase64), (character) => character.charCodeAt(0))
        : response.body || null;
      return new Response(body, {
        status: response.status,
        headers: { "Content-Type": response.contentType },
      });
    });
  }

  override watchVaultRevision(
    vaultId: string,
    onRevision: (revision: number) => void,
    onError?: (error: Error) => void
  ) {
    return this.bridge.watchVaultChanges(
      vaultId,
      (change) => onRevision(change.revision),
      (message) => onError?.(new Error(message))
    );
  }

  override watchVaultChanges(
    vaultId: string,
    onChange: (change: VaultChange) => void,
    onError?: (error: Error) => void
  ) {
    return this.bridge.watchVaultChanges(vaultId, onChange, (message) =>
      onError?.(new Error(message))
    );
  }
}
