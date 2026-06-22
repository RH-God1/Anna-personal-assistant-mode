export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "APP_ERROR"
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, "VALIDATION_ERROR");
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, message, "FORBIDDEN");
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, code = "rate_limited") {
    super(429, message, code);
  }
}

export class ProviderIntegrationError extends AppError {
  constructor(message: string) {
    super(502, message, "PROVIDER_INTEGRATION_ERROR");
  }
}

export class SupplierResponseError extends AppError {
  constructor(
    public readonly supplierResultCode:
      | "supplier_no_result"
      | "invalid_search_params"
      | "route_maybe_unsupported"
      | "supplier_error"
      | "rate_limited",
    message: string,
    statusCode = supplierResultCode === "rate_limited" ? 429 : supplierResultCode === "invalid_search_params" ? 400 : 502
  ) {
    super(statusCode, message, supplierResultCode);
  }
}
