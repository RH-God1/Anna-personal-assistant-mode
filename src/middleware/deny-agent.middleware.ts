import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../utils/errors.js";
import { getRequestContext } from "../utils/request-context.js";

export function denyAgentMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (getRequestContext(req).isAgent) {
    throw new ForbiddenError("Agent is not allowed to manage provider credentials or usage administration APIs");
  }
  next();
}
