import type {
  CreateFlightBookingInput,
  FlightBookingRecord,
  FlightOffer,
  FlightSearchInput,
  PriceFlightOfferInput,
  PricedFlightOffer
} from "../../models/types.js";

export interface FlightProvider {
  readonly name: string;
  searchFlights(input: FlightSearchInput): Promise<FlightOffer[]>;
  priceFlightOffer(input: PriceFlightOfferInput): Promise<PricedFlightOffer>;
  createFlightBooking(input: CreateFlightBookingInput): Promise<FlightBookingRecord>;
  getFlightBooking(bookingId: string): Promise<FlightBookingRecord>;
  cancelFlightBooking(bookingId: string): Promise<FlightBookingRecord>;
  getTicketStatus(bookingId: string): Promise<FlightBookingRecord["ticketStatus"]>;
}
