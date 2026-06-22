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
import { createId, mockDb, nowIso } from "../../store/mock-db.js";
import { NotFoundError } from "../../utils/errors.js";

export class MockHotelProvider implements HotelProvider {
  readonly name = "mock-hotel";

  async searchHotels(input: HotelSearchInput): Promise<HotelSummary[]> {
    const hotels = [
      this.createHotel(input, "Anna Central Hotel", 4.6, 145),
      this.createHotel(input, "Mock Riverside Suites", 4.3, 178)
    ];
    for (const hotel of hotels) {
      mockDb.hotels.set(hotel.id, hotel);
      for (const offer of hotel.offers) {
        mockDb.hotelOffers.set(offer.id, offer);
      }
    }
    return hotels.map(({ offers, amenities, ...summary }) => summary);
  }

  async getHotelDetails(hotelId: string): Promise<HotelDetails> {
    const hotel = mockDb.hotels.get(hotelId);
    if (!hotel) {
      throw new NotFoundError("Hotel not found");
    }
    return hotel;
  }

  async priceHotelOffer(input: PriceHotelOfferInput): Promise<PricedHotelOffer> {
    const offer = mockDb.hotelOffers.get(input.offerId);
    if (!offer) {
      throw new NotFoundError("Hotel offer not found");
    }

    const taxesAndFees = { amount: Math.round(offer.price.amount * 0.16), currency: offer.price.currency };
    const priced: PricedHotelOffer = {
      ...offer,
      pricedAt: nowIso(),
      taxesAndFees,
      total: { amount: offer.price.amount + taxesAndFees.amount, currency: offer.price.currency }
    };
    mockDb.pricedHotelOffers.set(priced.id, priced);
    return priced;
  }

  async createHotelBooking(input: CreateHotelBookingInput): Promise<HotelBookingRecord> {
    const offer = mockDb.pricedHotelOffers.get(input.offerId);
    if (!offer) {
      throw new NotFoundError("Priced hotel offer not found");
    }

    const booking: HotelBookingRecord = {
      id: input.bookingId,
      supplierBookingId: createId("mh_supplier"),
      confirmationNumber: `MH${Date.now().toString(36).toUpperCase()}`,
      status: "created",
      offer
    };
    mockDb.hotelBookings.set(booking.id, booking);
    return booking;
  }

  async getHotelBooking(bookingId: string): Promise<HotelBookingRecord> {
    const booking = mockDb.hotelBookings.get(bookingId);
    if (!booking) {
      throw new NotFoundError("Hotel booking not found");
    }
    return booking;
  }

  async cancelHotelBooking(bookingId: string): Promise<HotelBookingRecord> {
    const booking = await this.getHotelBooking(bookingId);
    booking.status = "cancelled";
    return booking;
  }

  private createHotel(input: HotelSearchInput, name: string, rating: number, nightlyRate: number): HotelDetails {
    const hotelId = createId("hotel");
    const nights = Math.max(
      1,
      Math.ceil((Date.parse(input.checkOutDate) - Date.parse(input.checkInDate)) / (24 * 60 * 60 * 1000))
    );

    return {
      id: hotelId,
      provider: this.name,
      name,
      cityCode: input.cityCode.toUpperCase(),
      rating,
      address: `${input.cityCode.toUpperCase()} central district`,
      amenities: ["wifi", "breakfast", "front_desk"],
      offers: [
        {
          id: createId("hotel_offer"),
          provider: this.name,
          hotelId,
          roomName: "Flexible king room",
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          guests: input.guests,
          rooms: input.rooms,
          price: { amount: nightlyRate * nights * input.rooms, currency: "USD" },
          cancellable: true,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }
      ]
    };
  }
}
