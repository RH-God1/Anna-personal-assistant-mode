import type { FlightProvider } from "./FlightProvider.js";
import type {
  CreateFlightBookingInput,
  FlightBookingRecord,
  FlightOffer,
  FlightSearchInput,
  PriceFlightOfferInput,
  PricedFlightOffer
} from "../../models/types.js";
import { createId, mockDb, nowIso } from "../../store/mock-db.js";
import { NotFoundError } from "../../utils/errors.js";

export class MockFlightProvider implements FlightProvider {
  readonly name = "mock-flight";

  async searchFlights(input: FlightSearchInput): Promise<FlightOffer[]> {
    const passengerCount = input.passengers.reduce((sum, passenger) => sum + passenger.count, 0);
    const base = Math.max(180, 120 + passengerCount * 95);
    const offers: FlightOffer[] = [
      this.createOffer(input, "AN", "AN188", base),
      this.createOffer(input, "MO", "MO521", base + 74)
    ];
    for (const offer of offers) {
      mockDb.flightOffers.set(offer.id, offer);
    }
    return offers;
  }

  async priceFlightOffer(input: PriceFlightOfferInput): Promise<PricedFlightOffer> {
    const offer = mockDb.flightOffers.get(input.offerId);
    if (!offer) {
      throw new NotFoundError("Flight offer not found");
    }

    const tax = { amount: Math.round(offer.price.amount * 0.12), currency: offer.price.currency };
    const priced: PricedFlightOffer = {
      ...offer,
      pricedAt: nowIso(),
      tax,
      total: { amount: offer.price.amount + tax.amount, currency: offer.price.currency }
    };
    mockDb.pricedFlightOffers.set(priced.id, priced);
    return priced;
  }

  async createFlightBooking(input: CreateFlightBookingInput): Promise<FlightBookingRecord> {
    const offer = mockDb.pricedFlightOffers.get(input.offerId);
    if (!offer) {
      throw new NotFoundError("Priced flight offer not found");
    }

    const booking: FlightBookingRecord = {
      id: input.bookingId,
      supplierBookingId: createId("mf_supplier"),
      confirmationNumber: `MF${Date.now().toString(36).toUpperCase()}`,
      status: "ticketed",
      ticketStatus: "ticketed",
      offer
    };
    mockDb.flightBookings.set(booking.id, booking);
    return booking;
  }

  async getFlightBooking(bookingId: string): Promise<FlightBookingRecord> {
    const booking = mockDb.flightBookings.get(bookingId);
    if (!booking) {
      throw new NotFoundError("Flight booking not found");
    }
    return booking;
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

  private createOffer(input: FlightSearchInput, airline: string, flightNumber: string, amount: number): FlightOffer {
    return {
      id: createId("flight_offer"),
      provider: this.name,
      origin: input.origin.toUpperCase(),
      destination: input.destination.toUpperCase(),
      departureDate: input.departureDate,
      returnDate: input.returnDate,
      airline,
      flightNumber,
      cabinClass: input.cabinClass ?? "economy",
      price: { amount, currency: "USD" },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };
  }
}
