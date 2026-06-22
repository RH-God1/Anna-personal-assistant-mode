import type { NextFunction, Request, Response } from "express";

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.headers["x-actor"] = req.headers["x-actor"] ?? "local-dev-user";
  next();
}
