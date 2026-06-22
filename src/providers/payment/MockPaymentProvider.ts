import type { PaymentProvider } from "./PaymentProvider.js";
import type {
  ChargeInput,
  CreateSetupIntentInput,
  PaymentRecord,
  RefundInput,
  SetupIntent
} from "../../models/types.js";
import { createId, mockDb, nowIso } from "../../store/mock-db.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock-payment";

  async createSetupIntent(_input: CreateSetupIntentInput): Promise<SetupIntent> {
    const intent: SetupIntent = {
      id: createId("seti"),
      status: "requires_payment_method",
      clientSecret: createId("seti_secret")
    };
    mockDb.setupIntents.set(intent.id, intent);
    return intent;
  }

  async charge(input: ChargeInput): Promise<PaymentRecord> {
    if (input.amount <= 0) {
      throw new ValidationError("Charge amount must be positive");
    }

    const payment: PaymentRecord = {
      id: createId("pay"),
      bookingId: input.bookingId,
      amount: input.amount,
      currency: input.currency,
      status: "succeeded",
      provider: this.name,
      createdAt: nowIso()
    };
    mockDb.payments.set(payment.id, payment);
    return payment;
  }

  async refund(input: RefundInput): Promise<PaymentRecord> {
    const payment = mockDb.payments.get(input.paymentId);
    if (!payment) {
      throw new NotFoundError("Payment not found");
    }
    payment.status = "refunded";
    return payment;
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentRecord["status"]> {
    const payment = mockDb.payments.get(paymentId);
    if (!payment) {
      throw new NotFoundError("Payment not found");
    }
    return payment.status;
  }
}
