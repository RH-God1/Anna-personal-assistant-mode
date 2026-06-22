import type { Request, Response } from "express";
import { z } from "zod";
import type { PaymentService } from "../services/payment.service.js";
import { getRequestContext } from "../utils/request-context.js";

const setupIntentSchema = z.object({
  bookingId: z.string().optional(),
  customerId: z.string().optional(),
  currency: z.enum(["USD", "EUR", "CNY", "JPY", "GBP"]).optional()
});

const confirmPaymentSchema = z.object({
  bookingId: z.string().min(1),
  userConfirmed: z.literal(true),
  paymentMethodId: z.string().optional()
});

const refundSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().positive().optional()
});

export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  createSetupIntent = async (req: Request, res: Response) => {
    const result = await this.paymentService.createSetupIntent(setupIntentSchema.parse(req.body), getRequestContext(req));
    res.status(201).json({ data: result });
  };

  confirm = async (req: Request, res: Response) => {
    const result = await this.paymentService.confirmPayment({
      ...confirmPaymentSchema.parse(req.body),
      context: getRequestContext(req)
    });
    res.json({ data: result });
  };

  refund = async (req: Request, res: Response) => {
    const result = await this.paymentService.refund(refundSchema.parse(req.body), getRequestContext(req));
    res.json({ data: result });
  };

  status = async (req: Request, res: Response) => {
    const result = await this.paymentService.getPaymentStatus(req.params.paymentId, getRequestContext(req));
    res.json({ data: { paymentId: req.params.paymentId, status: result } });
  };
}
