import type {
  CreateHotelBookingInput,
  HotelBookingRecord,
  HotelDetails,
  HotelSearchInput,
  HotelSummary,
  PriceHotelOfferInput,
  PricedHotelOffer
} from "../../models/types.js";

export interface HotelProvider {
  readonly name: string;
  searchHotels(input: HotelSearchInput): Promise<HotelSummary[]>;
  getHotelDetails(hotelId: string): Promise<HotelDetails>;
  priceHotelOffer(input: PriceHotelOfferInput): Promise<PricedHotelOffer>;
  createHotelBooking(input: CreateHotelBookingInput): Promise<HotelBookingRecord>;
  getHotelBooking(bookingId: string): Promise<HotelBookingRecord>;
  cancelHotelBooking(bookingId: string): Promise<HotelBookingRecord>;
}
