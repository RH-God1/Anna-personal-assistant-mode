import type { Request, Response } from "express";
import { z } from "zod";
import type { ProviderCredentialService } from "../services/provider-credential.service.js";
import { getRequestContext } from "../utils/request-context.js";

const providerSchema = z.enum(["duffel", "amadeus", "travelport", "expedia", "hotelbeds", "agoda", "stripe", "cybersource"]);

const createCredentialSchema = z.object({
  ownerType: z.enum(["tenant", "user"]).default("tenant"),
  ownerId: z.string().optional(),
  provider: providerSchema,
  mode: z.enum(["sandbox", "production"]).default("sandbox"),
  authType: z.enum(["api_key", "oauth"]).default("api_key"),
  secret: z.string().min(8),
  refreshToken: z.string().min(8).optional(),
  accessTokenExpiresAt: z.string().optional()
});

const rotateCredentialSchema = z.object({
  secret: z.string().min(8)
});

export class ProviderCredentialController {
  constructor(private readonly credentialService: ProviderCredentialService) {}

  create = (req: Request, res: Response) => {
    const context = getRequestContext(req);
    const input = createCredentialSchema.parse(req.body);
    const ownerId = input.ownerId ?? (input.ownerType === "tenant" ? context.tenantId : context.userId);
    const credential = this.credentialService.create({ ...input, ownerId }, context.actor);
    res.status(201).json({ data: this.toListItem(credential) });
  };

  list = (req: Request, res: Response) => {
    const context = getRequestContext(req);
    const credentials = this.credentialService
      .listVisible({ tenantId: context.tenantId, userId: context.userId })
      .map((credential) => this.toListItem(credential));
    res.json({ data: credentials });
  };

  delete = (req: Request, res: Response) => {
    const context = getRequestContext(req);
    this.credentialService.revokeAndDelete(req.params.id, context.actor, context);
    res.status(204).send();
  };

  rotate = (req: Request, res: Response) => {
    const context = getRequestContext(req);
    const input = rotateCredentialSchema.parse(req.body);
    const credential = this.credentialService.rotate(req.params.id, input.secret, context.actor, context);
    res.json({ data: this.toListItem(credential) });
  };

  private toListItem(credential: {
    id: string;
    ownerType: string;
    provider: string;
    mode: string;
    last4: string;
    status: string;
    lastUsedAt?: string;
  }) {
    return {
      id: credential.id,
      ownerType: credential.ownerType,
      provider: credential.provider,
      mode: credential.mode,
      last4: credential.last4,
      status: credential.status,
      lastUsedAt: credential.lastUsedAt
    };
  }
}
