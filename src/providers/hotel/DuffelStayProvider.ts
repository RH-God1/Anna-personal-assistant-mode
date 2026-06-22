import type {
  CreateHotelBookingInput,
  HotelBookingRecord,
  HotelDetails,
  HotelOffer,
  HotelSearchInput,
  HotelSummary,
  PriceHotelOfferInput,
  PricedHotelOffer
} from "../../models/types.js";
import { createId, mockDb, nowIso } from "../../store/mock-db.js";
import { NotFoundError, SupplierResponseError } from "../../utils/errors.js";
import type { HotelProvider } from "./HotelProvider.js";
import { DuffelProvider } from "../duffel/DuffelProvider.js";

export class DuffelStayProvider implements HotelProvider {
  readonly name = "duffel";

  constructor(private readonly duffel: DuffelProvider = new DuffelProvider()) {}

  async searchHotels(input: HotelSearchInput): Promise<HotelSummary[]> {
    if (!this.duffel.supportsStays()) {
      throw new SupplierResponseError(
        "route_maybe_unsupported",
        "Duffel Stays is not enabled for this backend. Current supplier may not cover accommodation for this request.",
        501
      );
    }
    const result = await this.duffel.searchStays({
      location: input.cityCode,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      guests: input.guests,
      rooms: input.rooms
    });
    const hotels = extractArray(result).map((item) => mapStaySummary(item, input.cityCode));
    for (const hotel of hotels) {
      mockDb.hotels.set(hotel.id, {
        ...hotel,
        amenities: [],
        offers: []
      });
    }
    return hotels;
  }

  async getHotelDetails(hotelId: string): Promise<HotelDetails> {
    const hotel = mockDb.hotels.get(hotelId);
    if (!hotel) throw new NotFoundError("Duffel stay not found");
    return hotel;
  }

  async priceHotelOffer(input: PriceHotelOfferInput): Promise<PricedHotelOffer> {
    const offer = mockDb.hotelOffers.get(input.offerId);
    if (!offer) throw new NotFoundError("Duffel stay rate not found");
    const fees = Math.round(offer.price.amount * 0.12);
    const priced: PricedHotelOffer = {
      ...offer,
      pricedAt: nowIso(),
      taxesAndFees: { amount: fees, currency: offer.price.currency },
      total: { amount: offer.price.amount + fees, currency: offer.price.currency }
    };
    mockDb.pricedHotelOffers.set(priced.id, priced);
    return priced;
  }

  async createHotelBooking(input: CreateHotelBookingInput): Promise<HotelBookingRecord> {
    const offer = mockDb.pricedHotelOffers.get(input.offerId);
    if (!offer) throw new NotFoundError("Priced Duffel stay offer not found");
    const booking: HotelBookingRecord = {
      id: input.bookingId,
      supplierBookingId: createId("duffel_stay_booking"),
      confirmationNumber: `DS${Date.now().toString(36).toUpperCase()}`,
      status: "created",
      offer
    };
    mockDb.hotelBookings.set(booking.id, booking);
    return booking;
  }

  async getHotelBooking(bookingId: string): Promise<HotelBookingRecord> {
    const booking = mockDb.hotelBookings.get(bookingId);
    if (!booking) throw new NotFoundError("Duffel stay booking not found");
    return booking;
  }

  async cancelHotelBooking(bookingId: string): Promise<HotelBookingRecord> {
    const booking = await this.getHotelBooking(bookingId);
    booking.status = "cancelled";
    return booking;
  }
}

function extractArray(value: Record<string, unknown>): Record<string, unknown>[] {
  const data = Array.isArray(value.data) ? value.data : Array.isArray(value.results) ? value.results : [];
  return data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

function mapStaySummary(raw: Record<string, unknown>, cityCode: string): HotelSummary {
  const id = String(raw.id || raw.accommodation_id || createId("duffel_stay"));
  const name = String(raw.name || raw.accommodation_name || "Duffel Stay");
  const address = raw.address && typeof raw.address === "object"
    ? Object.values(raw.address).filter(Boolean).join(", ")
    : String(raw.address || cityCode);
  return {
    id,
    provider: "duffel",
    name,
    cityCode,
    rating: Number(raw.rating || 0),
    address
  };
}
