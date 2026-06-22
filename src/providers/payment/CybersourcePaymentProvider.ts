import { StripePaymentProvider } from "./StripePaymentProvider.js";

export class CybersourcePaymentProvider extends StripePaymentProvider {
  readonly name = "cybersource";
}
