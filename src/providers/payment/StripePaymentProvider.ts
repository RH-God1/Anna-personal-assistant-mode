import type { PaymentProvider } from "./PaymentProvider.js";
import type { ChargeInput, CreateSetupIntentInput, PaymentRecord, RefundInput, SetupIntent } from "../../models/types.js";
import { ProviderIntegrationError } from "../../utils/errors.js";

export class StripePaymentProvider implements PaymentProvider {
  readonly name: string = "stripe";

  async createSetupIntent(_input: CreateSetupIntentInput): Promise<SetupIntent> {
    throw this.notConfigured();
  }

  async charge(_input: ChargeInput): Promise<PaymentRecord> {
    throw this.notConfigured("Stripe charging is disabled until credentials and webhook signature verification are configured.");
  }

  async refund(_input: RefundInput): Promise<PaymentRecord> {
    throw this.notConfigured();
  }

  async getPaymentStatus(_paymentId: string): Promise<PaymentRecord["status"]> {
    throw this.notConfigured();
  }

  private notConfigured(message = "Stripe provider is scaffolded but not configured. Use MockPaymentProvider locally."): ProviderIntegrationError {
    return new ProviderIntegrationError(message);
  }
}
