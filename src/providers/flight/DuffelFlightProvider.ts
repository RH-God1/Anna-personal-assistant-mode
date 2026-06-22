import type { FlightProvider } from "./FlightProvider.js";
import type {
  CreateFlightBookingInput,
  FlightBookingRecord,
  FlightOffer,
  FlightSearchInput,
  PriceFlightOfferInput,
  PricedFlightOffer
} from "../../models/types.js";
import { mockDb } from "../../store/mock-db.js";
import { DuffelProvider } from "../duffel/DuffelProvider.js";

export class DuffelFlightProvider implements FlightProvider {
  readonly name = "duffel";

  constructor(private readonly duffel: DuffelProvider = new DuffelProvider()) {}

  async searchFlights(input: FlightSearchInput): Promise<FlightOffer[]> {
    return this.duffel.searchFlights(input);
  }

  async priceFlightOffer(input: PriceFlightOfferInput): Promise<PricedFlightOffer> {
    return this.duffel.refreshOffer(input.offerId);
  }

  async createFlightBooking(input: CreateFlightBookingInput): Promise<FlightBookingRecord> {
    return this.duffel.confirmBooking({
      offerId: input.offerId,
      bookingId: input.bookingId,
      idempotencyKey: input.idempotencyKey,
      orderType: input.orderType ?? "hold",
      passengers: input.passengers ?? [],
      payment: input.payment,
      userConfirmed: true
    });
  }

  async getFlightBooking(bookingId: string): Promise<FlightBookingRecord> {
    const order = await this.duffel.getOrder(bookingId);
    const existing = [...mockDb.flightBookings.values()]
      .find((booking) => booking.id === bookingId || booking.supplierBookingId === bookingId);
    if (existing) return existing;
    return {
      id: bookingId,
      supplierBookingId: String(order.id ?? bookingId),
      confirmationNumber: String(order.booking_reference ?? bookingId.slice(-8).toUpperCase()),
      status: "created",
      ticketStatus: "not_ticketed",
      offer: await this.duffel.getOffer(String(order.offer_id ?? bookingId))
    };
  }

  async cancelFlightBooking(bookingId: string): Promise<FlightBookingRecord> {
    const booking = await this.getFlightBooking(bookingId);
    booking.status = "cancelled";
    booking.ticketStatus = "voided";
    return booking;
  }

  async getTicketStatus(bookingId: string): Promise<FlightBookingRecord["ticketStatus"]> {
    return (await this.getFlightBooking(bookingId)).ticketStatus;
  }
}
