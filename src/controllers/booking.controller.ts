import type { Request, Response } from "express";
import { z } from "zod";
import type { BookingService } from "../services/booking.service.js";

const prepareSchema = z.object({
  type: z.enum(["flight", "hotel"]),
  offerId: z.string().min(1)
});

const confirmSchema = z.object({
  bookingId: z.string().min(1),
  userConfirmed: z.literal(true)
});

const cancelSchema = z.object({
  bookingId: z.string().min(1)
});

export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  prepare = (req: Request, res: Response) => {
    const result = this.bookingService.prepare(prepareSchema.parse(req.body));
    res.status(201).json({ data: result });
  };

  confirm = (req: Request, res: Response) => {
    const input = confirmSchema.parse(req.body);
    const result = this.bookingService.confirmUser(input.bookingId, input.userConfirmed);
    res.json({ data: result });
  };

  get = (req: Request, res: Response) => {
    const result = this.bookingService.get(req.params.bookingId);
    res.json({ data: result });
  };

  cancel = (req: Request, res: Response) => {
    const input = cancelSchema.parse(req.body);
    const result = this.bookingService.cancel(input.bookingId);
    res.json({ data: result });
  };
}
