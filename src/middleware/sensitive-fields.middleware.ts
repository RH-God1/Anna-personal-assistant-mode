import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../utils/errors.js";

const forbiddenFieldNames = new Set([
  "cardnumber",
  "card_number",
  "pan",
  "cvv",
  "cvc",
  "securitycode",
  "security_code",
  "smscode",
  "sms_code",
  "otp",
  "threedsecurecode",
  "3dsecurecode",
  "verificationcode",
  "verification_code"
]);

export function sensitiveFieldsMiddleware(req: Request, _res: Response, next: NextFunction) {
  const path = findForbiddenPath(req.body);
  if (path) {
    throw new ForbiddenError(`Sensitive payment/authentication field is not allowed: ${path}`);
  }
  next();
}

function findForbiddenPath(value: unknown, path = "body"): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenPath(value[index], `${path}[${index}]`);
      if (found) {
        return found;
      }
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[\s-]/g, "");
    if (forbiddenFieldNames.has(normalized)) {
      return `${path}.${key}`;
    }
    const found = findForbiddenPath(child, `${path}.${key}`);
    if (found) {
      return found;
    }
  }
  return null;
}
