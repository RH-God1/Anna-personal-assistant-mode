import type { HotelProvider } from "./HotelProvider.js";
import type {
  CreateHotelBookingInput,
  HotelBookingRecord,
  HotelDetails,
  HotelSearchInput,
  HotelSummary,
  PriceHotelOfferInput,
  PricedHotelOffer
} from "../../models/types.js";
import { ProviderIntegrationError } from "../../utils/errors.js";

export class AmadeusHotelProvider implements HotelProvider {
  readonly name: string = "amadeus-hotel";

  async searchHotels(_input: HotelSearchInput): Promise<HotelSummary[]> {
    throw this.notConfigured();
  }

  async getHotelDetails(_hotelId: string): Promise<HotelDetails> {
    throw this.notConfigured();
  }

  async priceHotelOffer(_input: PriceHotelOfferInput): Promise<PricedHotelOffer> {
    throw this.notConfigured();
  }

  async createHotelBooking(_input: CreateHotelBookingInput): Promise<HotelBookingRecord> {
    throw this.notConfigured("Amadeus hotel booking is disabled until credentials and explicit production gates are configured.");
  }

  async getHotelBooking(_bookingId: string): Promise<HotelBookingRecord> {
    throw this.notConfigured();
  }

  async cancelHotelBooking(_bookingId: string): Promise<HotelBookingRecord> {
    throw this.notConfigured();
  }

  private notConfigured(message = "Amadeus hotel provider is scaffolded but not configured. Use MockHotelProvider locally."): ProviderIntegrationError {
    return new ProviderIntegrationError(message);
  }
}
