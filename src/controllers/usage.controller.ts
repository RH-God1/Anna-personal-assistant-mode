import type { Request, Response } from "express";
import type { UsageService } from "../services/usage.service.js";
import { getRequestContext } from "../utils/request-context.js";

export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  me = (req: Request, res: Response) => {
    const context = getRequestContext(req);
    res.json({ data: this.usageService.getUserUsage(context.userId) });
  };

  tenant = (req: Request, res: Response) => {
    const context = getRequestContext(req);
    res.json({ data: this.usageService.getTenantUsage(context.tenantId) });
  };
}
