import type { Request, Response } from "express";
import { z } from "zod";
import type { BookingService } from "../services/booking.service.js";
import { IdempotencyService } from "../services/idempotency.service.js";
import type { TravelOrchestrator } from "../services/travel-orchestrator.service.js";
import { getRequestContext } from "../utils/request-context.js";

const passengerSchema = z.object({
  type: z.enum(["adult", "child", "infant"]),
  count: z.number().int().positive()
});

const flightSearchSchema = z.object({
  origin: z.string().min(3),
  destination: z.string().min(3),
  departureDate: z.string().min(10),
  returnDate: z.string().min(10).optional(),
  passengers: z.array(passengerSchema).min(1),
  cabinClass: z.enum(["economy", "premium_economy", "business", "first"]).optional()
});

const hotelSearchSchema = z.object({
  cityCode: z.string().min(3),
  checkInDate: z.string().min(10),
  checkOutDate: z.string().min(10),
  guests: z.number().int().positive(),
  rooms: z.number().int().positive()
});

const offerIdSchema = z.object({ offerId: z.string().min(1) });

const duffelPassengerSchema = z.object({
  id: z.string().min(1).optional(),
  type: z.enum(["adult", "child", "infant"]).optional(),
  title: z.string().min(1).max(20).optional(),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  bornOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(["m", "f"]).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().min(4).max(32).optional()
});

const paymentSchema = z.object({
  type: z.literal("balance").optional(),
  amount: z.string().optional(),
  currency: z.enum(["USD", "EUR", "CNY", "JPY", "GBP"]).optional(),
  threeDSecureSessionId: z.string().optional()
});

const prepareFlightSchema = z.object({
  offerId: z.string().min(1),
  passengers: z.array(duffelPassengerSchema).min(1),
  orderType: z.enum(["instant", "hold"]).optional(),
  idempotencyKey: z.string().min(8).optional()
});

const confirmFlightSchema = prepareFlightSchema.extend({
  bookingId: z.string().min(1),
  userConfirmed: z.literal(true),
  payment: paymentSchema.optional()
});

const payHoldOrderSchema = z.object({
  orderId: z.string().min(1),
  amount: z.string().optional(),
  currency: z.enum(["USD", "EUR", "CNY", "JPY", "GBP"]).optional(),
  userConfirmed: z.literal(true),
  idempotencyKey: z.string().min(8).optional()
});

const staySearchSchema = z.object({
  location: z.string().min(2),
  checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.number().int().positive(),
  rooms: z.number().int().positive(),
  idempotencyKey: z.string().min(8).optional()
});

const stayRatesSchema = z.object({
  searchResultId: z.string().min(1),
  idempotencyKey: z.string().min(8).optional()
});

const stayQuoteSchema = z.object({
  rateId: z.string().min(1),
  idempotencyKey: z.string().min(8).optional()
});

const stayBookingSchema = z.object({
  quoteId: z.string().min(1),
  guests: z.array(z.object({
    givenName: z.string().min(1),
    familyName: z.string().min(1)
  })).min(1),
  userConfirmed: z.literal(true),
  idempotencyKey: z.string().min(8).optional()
});

const NO_DUFFEL_OFFERS_MESSAGE = "当前通过 Duffel 没有查到可预订报价。";

export class TravelController {
  constructor(
    private readonly travelOrchestrator: TravelOrchestrator,
    private readonly bookingService: BookingService,
    private readonly idempotencyService: IdempotencyService = new IdempotencyService()
  ) {}

  searchFlights = async (req: Request, res: Response) => {
    const body = flightSearchSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req);
    const response = await this.idempotencyService.run("travel.flights.search", idempotencyKey, body, async () => {
      const result = await this.travelOrchestrator.searchFlights(body, getRequestContext(req));
      return travelResponse(result, idempotencyKey);
    });
    res.json(response);
  };

  priceFlight = async (req: Request, res: Response) => {
    const body = offerIdSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req);
    const response = await this.idempotencyService.run("travel.flights.price", idempotencyKey, body, async () => {
      const result = await this.travelOrchestrator.priceFlightOffer(body, getRequestContext(req));
      return travelResponse(result, idempotencyKey);
    });
    res.json(response);
  };

  getOffer = async (req: Request, res: Response) => {
    const idempotencyKey = this.idempotencyKey(req);
    const result = await this.travelOrchestrator.getOffer(req.params.offerId, getRequestContext(req));
    res.json(travelResponse(result, idempotencyKey));
  };

  refreshOffer = async (req: Request, res: Response) => {
    const idempotencyKey = this.idempotencyKey(req);
    const response = await this.idempotencyService.run("travel.flights.offer.refresh", idempotencyKey, {
      offerId: req.params.offerId
    }, async () => {
      const result = await this.travelOrchestrator.refreshOffer(req.params.offerId, getRequestContext(req), idempotencyKey);
      return travelResponse(result, idempotencyKey);
    });
    res.json(response);
  };

  prepareFlightBooking = async (req: Request, res: Response) => {
    const input = prepareFlightSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req, input.idempotencyKey);
    const response = await this.idempotencyService.run("travel.flights.booking.prepare", idempotencyKey, input, async () => {
      const pricedOffer = await this.travelOrchestrator.prepareFlightBooking({
        ...input,
        idempotencyKey
      }, getRequestContext(req));
      const result = this.bookingService.prepare({
        type: "flight",
        offerId: input.offerId,
        passengers: input.passengers,
        idempotencyKey,
        preparedSnapshot: {
          pricedAt: pricedOffer.pricedAt,
          total: pricedOffer.total,
          orderType: input.orderType ?? "hold"
        }
      });
      return travelResponse(result, idempotencyKey);
    });
    res.status(201).json(response);
  };

  confirmFlightBooking = async (req: Request, res: Response) => {
    const input = confirmFlightSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req, input.idempotencyKey);
    const response = await this.idempotencyService.run("travel.flights.booking.confirm", idempotencyKey, input, async () => {
      const result = await this.bookingService.confirmSupplierBooking({
        bookingId: input.bookingId,
        userConfirmed: input.userConfirmed,
        passengers: input.passengers,
        orderType: input.orderType ?? "hold",
        payment: input.payment,
        context: getRequestContext(req),
        idempotencyKey
      });
      return travelResponse(result, idempotencyKey);
    });
    res.json(response);
  };

  payHoldOrder = async (req: Request, res: Response) => {
    const input = payHoldOrderSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req, input.idempotencyKey);
    const response = await this.idempotencyService.run("travel.flights.order.pay_hold", idempotencyKey, input, async () => {
      const result = await this.travelOrchestrator.payHoldOrder({ ...input, idempotencyKey }, getRequestContext(req));
      return travelResponse(result, idempotencyKey);
    });
    res.json(response);
  };

  getFlightBooking = async (req: Request, res: Response) => {
    const booking = this.bookingService.get(req.params.bookingId);
    res.json(travelResponse(booking, this.idempotencyKey(req)));
  };

  getDuffelOrder = async (req: Request, res: Response) => {
    const result = await this.travelOrchestrator.getDuffelOrder(req.params.orderId, getRequestContext(req));
    res.json(travelResponse(result, this.idempotencyKey(req)));
  };

  searchHotels = async (req: Request, res: Response) => {
    const result = await this.travelOrchestrator.searchHotels(hotelSearchSchema.parse(req.body), getRequestContext(req));
    res.json(travelResponse(result, this.idempotencyKey(req)));
  };

  getHotelDetails = async (req: Request, res: Response) => {
    const result = await this.travelOrchestrator.getHotelDetails(req.params.hotelId, getRequestContext(req));
    res.json(travelResponse(result, this.idempotencyKey(req)));
  };

  priceHotel = async (req: Request, res: Response) => {
    const result = await this.travelOrchestrator.priceHotelOffer(offerIdSchema.parse(req.body), getRequestContext(req));
    res.json(travelResponse(result, this.idempotencyKey(req)));
  };

  prepareHotelBooking = async (req: Request, res: Response) => {
    const { offerId } = offerIdSchema.parse(req.body);
    const result = this.bookingService.prepare({ type: "hotel", offerId, idempotencyKey: this.idempotencyKey(req) });
    res.status(201).json(travelResponse(result, this.idempotencyKey(req)));
  };

  getHotelBooking = async (req: Request, res: Response) => {
    const booking = this.bookingService.get(req.params.bookingId);
    res.json(travelResponse(booking, this.idempotencyKey(req)));
  };

  searchStays = async (req: Request, res: Response) => {
    const input = staySearchSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req, input.idempotencyKey);
    const response = await this.idempotencyService.run("travel.stays.search", idempotencyKey, input, async () => {
      const result = await this.travelOrchestrator.searchStays(input, getRequestContext(req), idempotencyKey);
      return travelResponse(result, idempotencyKey);
    });
    res.json(response);
  };

  getStayRates = async (req: Request, res: Response) => {
    const input = stayRatesSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req, input.idempotencyKey);
    const response = await this.idempotencyService.run("travel.stays.rates", idempotencyKey, input, async () => {
      const result = await this.travelOrchestrator.getStayRates(input, getRequestContext(req), idempotencyKey);
      return travelResponse(result, idempotencyKey);
    });
    res.json(response);
  };

  createStayQuote = async (req: Request, res: Response) => {
    const input = stayQuoteSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req, input.idempotencyKey);
    const response = await this.idempotencyService.run("travel.stays.quote.prepare", idempotencyKey, input, async () => {
      const result = await this.travelOrchestrator.createStayQuote(input, getRequestContext(req), idempotencyKey);
      return travelResponse(result, idempotencyKey);
    });
    res.status(201).json(response);
  };

  createStayBooking = async (req: Request, res: Response) => {
    const input = stayBookingSchema.parse(req.body);
    const idempotencyKey = this.idempotencyKey(req, input.idempotencyKey);
    const response = await this.idempotencyService.run("travel.stays.booking.confirm", idempotencyKey, input, async () => {
      const result = await this.travelOrchestrator.createStayBooking({ ...input, idempotencyKey }, getRequestContext(req));
      return travelResponse(result, idempotencyKey);
    });
    res.status(201).json(response);
  };

  getStayBooking = async (req: Request, res: Response) => {
    const result = await this.travelOrchestrator.getStayBooking(req.params.bookingId, getRequestContext(req));
    res.json(travelResponse(result, this.idempotencyKey(req)));
  };

  private idempotencyKey(req: Request, explicit?: string): string {
    const header = req.header("Idempotency-Key") ?? req.header("X-Idempotency-Key");
    return this.idempotencyService.keyFrom(explicit ?? header ?? req.body?.idempotencyKey);
  };
}

function travelResponse<T>(data: T, idempotencyKey: string) {
  const noResult = Array.isArray(data) && data.length === 0;
  return {
    data,
    supplier: "duffel",
    resultCode: noResult ? "supplier_no_result" : "ok",
    ...(noResult ? { message: NO_DUFFEL_OFFERS_MESSAGE } : {}),
    idempotencyKey
  };
}
