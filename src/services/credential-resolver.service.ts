import type { ProviderKey } from "../models/types.js";
import type { ProviderCredentialService } from "./provider-credential.service.js";

export class CredentialResolver {
  constructor(private readonly credentialService: ProviderCredentialService) {}

  resolve(provider: ProviderKey, tenantId: string, userId: string) {
    return this.credentialService.resolveForBackend(provider, tenantId, userId);
  }
}
