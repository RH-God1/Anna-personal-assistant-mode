import type {
  ChargeInput,
  CreateSetupIntentInput,
  PaymentRecord,
  RefundInput,
  SetupIntent
} from "../../models/types.js";

export interface PaymentProvider {
  readonly name: string;
  createSetupIntent(input: CreateSetupIntentInput): Promise<SetupIntent>;
  charge(input: ChargeInput): Promise<PaymentRecord>;
  refund(input: RefundInput): Promise<PaymentRecord>;
  getPaymentStatus(paymentId: string): Promise<PaymentRecord["status"]>;
}
