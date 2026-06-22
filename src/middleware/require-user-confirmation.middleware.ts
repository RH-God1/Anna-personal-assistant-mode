import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../utils/errors.js";

export function requireUserConfirmationMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (req.body?.userConfirmed !== true) {
    throw new ForbiddenError("This action requires userConfirmed: true");
  }
  next();
}
