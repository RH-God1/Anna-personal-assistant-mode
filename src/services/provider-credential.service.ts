import type { ProviderCredential, ProviderKey, SafeProviderCredential } from "../models/types.js";
import { createId, mockDb, nowIso } from "../store/mock-db.js";
import { auditLog } from "../utils/audit-log.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors.js";
import type { EnvelopeEncryptionService } from "./envelope-encryption.service.js";

export interface CreateProviderCredentialInput {
  ownerType: ProviderCredential["ownerType"];
  ownerId: string;
  provider: ProviderKey;
  mode: ProviderCredential["mode"];
  authType: ProviderCredential["authType"];
  secret: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
}

export class ProviderCredentialService {
  constructor(private readonly encryption: EnvelopeEncryptionService) {}

  create(input: CreateProviderCredentialInput, actor = "backend"): SafeProviderCredential {
    this.assertSecret(input.secret);
    const now = nowIso();
    const existing = [...mockDb.providerCredentials.values()].find(
      (credential) =>
        credential.ownerType === input.ownerType &&
        credential.ownerId === input.ownerId &&
        credential.provider === input.provider &&
        credential.mode === input.mode &&
        credential.status === "active"
    );
    if (existing) {
      existing.status = "revoked";
      existing.updatedAt = now;
    }

    const credential: ProviderCredential = {
      id: createId("pcred"),
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      provider: input.provider,
      mode: input.mode,
      authType: input.authType,
      encryptedSecret: this.encryption.encryptSecret(input.secret),
      encryptedRefreshToken: input.refreshToken ? this.encryption.encryptSecret(input.refreshToken) : undefined,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      keyVersion: existing ? existing.keyVersion + 1 : 1,
      last4: input.secret.slice(-4),
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    mockDb.providerCredentials.set(credential.id, credential);
    auditLog({
      action: "provider_credential.create",
      actor,
      targetId: credential.id,
      metadata: { ownerType: credential.ownerType, provider: credential.provider, mode: credential.mode }
    });
    return this.toSafeCredential(credential);
  }

  listVisible(input: { tenantId: string; userId: string; includePlatform?: boolean }): SafeProviderCredential[] {
    return [...mockDb.providerCredentials.values()]
      .filter((credential) => {
        if (credential.ownerType === "tenant" && credential.ownerId === input.tenantId) {
          return true;
        }
        if (credential.ownerType === "user" && credential.ownerId === input.userId) {
          return true;
        }
        return input.includePlatform === true && credential.ownerType === "platform";
      })
      .map((credential) => this.toSafeCredential(credential));
  }

  rotate(id: string, secret: string, actor = "backend", scope?: { tenantId: string; userId: string }): SafeProviderCredential {
    this.assertSecret(secret);
    const credential = this.getOwnedCredential(id);
    this.assertScope(credential, scope);
    credential.encryptedSecret = this.encryption.encryptSecret(secret);
    credential.last4 = secret.slice(-4);
    credential.keyVersion += 1;
    credential.status = "active";
    credential.updatedAt = nowIso();
    auditLog({
      action: "provider_credential.rotate",
      actor,
      targetId: id,
      metadata: { provider: credential.provider, keyVersion: credential.keyVersion }
    });
    return this.toSafeCredential(credential);
  }

  revokeAndDelete(id: string, actor = "backend", scope?: { tenantId: string; userId: string }): void {
    const credential = this.getOwnedCredential(id);
    this.assertScope(credential, scope);
    credential.status = "revoked";
    credential.updatedAt = nowIso();
    auditLog({
      action: "provider_credential.delete",
      actor,
      targetId: id,
      metadata: { provider: credential.provider, ownerType: credential.ownerType }
    });
    mockDb.providerCredentials.delete(id);
  }

  resolveForBackend(provider: ProviderKey, tenantId: string, userId: string): { credential: ProviderCredential; secret: string } {
    const credential = this.resolveCredentialRecord(provider, tenantId, userId);
    const now = nowIso();
    credential.lastUsedAt = now;
    credential.updatedAt = now;
    auditLog({
      action: "provider_credential.use",
      actor: "backend",
      targetId: credential.id,
      metadata: {
        ownerType: credential.ownerType,
        provider: credential.provider,
        mode: credential.mode,
        keyVersion: credential.keyVersion
      }
    });
    return { credential, secret: this.encryption.decryptSecret(credential.encryptedSecret) };
  }

  seedPlatformCredential(provider: ProviderKey, secret: string, mode: ProviderCredential["mode"] = "sandbox") {
    const exists = [...mockDb.providerCredentials.values()].some(
      (credential) => credential.ownerType === "platform" && credential.provider === provider && credential.mode === mode
    );
    if (!exists) {
      this.create(
        {
          ownerType: "platform",
          ownerId: "platform",
          provider,
          mode,
          authType: provider === "amadeus" || provider === "cybersource" ? "oauth" : "api_key",
          secret
        },
        "system"
      );
    }
  }

  private resolveCredentialRecord(provider: ProviderKey, tenantId: string, userId: string): ProviderCredential {
    const active = [...mockDb.providerCredentials.values()].filter(
      (credential) => credential.provider === provider && credential.status === "active"
    );
    const tenantCredential = active.find((credential) => credential.ownerType === "tenant" && credential.ownerId === tenantId);
    if (tenantCredential) {
      return tenantCredential;
    }
    const userCredential = active.find((credential) => credential.ownerType === "user" && credential.ownerId === userId);
    if (userCredential) {
      return userCredential;
    }
    const platformCredential = active.find((credential) => credential.ownerType === "platform");
    if (platformCredential) {
      return platformCredential;
    }
    throw new ValidationError(`No active provider credential configured for ${provider}`);
  }

  private getOwnedCredential(id: string): ProviderCredential {
    const credential = mockDb.providerCredentials.get(id);
    if (!credential) {
      throw new NotFoundError("Provider credential not found");
    }
    if (credential.ownerType === "platform") {
      throw new ForbiddenError("Platform credentials must be managed through backend operations");
    }
    return credential;
  }

  private assertScope(credential: ProviderCredential, scope?: { tenantId: string; userId: string }) {
    if (!scope) {
      return;
    }
    if (credential.ownerType === "tenant" && credential.ownerId === scope.tenantId) {
      return;
    }
    if (credential.ownerType === "user" && credential.ownerId === scope.userId) {
      return;
    }
    throw new ForbiddenError("Provider credential is outside the current user or tenant scope");
  }

  private assertSecret(secret: string) {
    if (!secret || secret.length < 8) {
      throw new ValidationError("Provider credential secret must be at least 8 characters");
    }
  }

  private toSafeCredential(credential: ProviderCredential): SafeProviderCredential {
    return {
      id: credential.id,
      ownerType: credential.ownerType,
      ownerId: credential.ownerId,
      provider: credential.provider,
      mode: credential.mode,
      authType: credential.authType,
      keyVersion: credential.keyVersion,
      last4: credential.last4,
      status: credential.status,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      lastUsedAt: credential.lastUsedAt
    };
  }
}
