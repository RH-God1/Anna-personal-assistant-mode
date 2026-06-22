import type { FlightProvider } from "./FlightProvider.js";
import type {
  CreateFlightBookingInput,
  FlightBookingRecord,
  FlightOffer,
  FlightSearchInput,
  PriceFlightOfferInput,
  PricedFlightOffer
} from "../../models/types.js";
import { ProviderIntegrationError } from "../../utils/errors.js";

export class AmadeusFlightProvider implements FlightProvider {
  readonly name = "amadeus-flight";

  async searchFlights(_input: FlightSearchInput): Promise<FlightOffer[]> {
    throw this.notConfigured();
  }

  async priceFlightOffer(_input: PriceFlightOfferInput): Promise<PricedFlightOffer> {
    throw this.notConfigured();
  }

  async createFlightBooking(_input: CreateFlightBookingInput): Promise<FlightBookingRecord> {
    throw this.notConfigured("Amadeus flight order creation is disabled until credentials and explicit production gates are configured.");
  }

  async getFlightBooking(_bookingId: string): Promise<FlightBookingRecord> {
    throw this.notConfigured();
  }

  async cancelFlightBooking(_bookingId: string): Promise<FlightBookingRecord> {
    throw this.notConfigured();
  }

  async getTicketStatus(_bookingId: string): Promise<FlightBookingRecord["ticketStatus"]> {
    throw this.notConfigured();
  }

  private notConfigured(message = "Amadeus flight provider is scaffolded but not configured. Use MockFlightProvider locally."): ProviderIntegrationError {
    return new ProviderIntegrationError(message);
  }
}
