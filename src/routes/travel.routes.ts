import { Router } from "express";
import type { TravelController } from "../controllers/travel.controller.js";
import { asyncRoute } from "../utils/async-route.js";

export function createTravelRouter(controller: TravelController): Router {
  const router = Router();

  router.post("/flights/search", asyncRoute(controller.searchFlights));
  router.post("/flights/price", asyncRoute(controller.priceFlight));
  router.get("/flights/offers/:offerId", asyncRoute(controller.getOffer));
  router.post("/flights/offers/:offerId/refresh", asyncRoute(controller.refreshOffer));
  router.post("/flights/prepare", asyncRoute(controller.prepareFlightBooking));
  router.post("/flights/confirm", asyncRoute(controller.confirmFlightBooking));
  router.post("/flights/prepare-booking", asyncRoute(controller.prepareFlightBooking));
  router.post("/flights/orders/pay-hold", asyncRoute(controller.payHoldOrder));
  router.get("/flights/orders/:orderId", asyncRoute(controller.getDuffelOrder));
  router.get("/flights/bookings/:bookingId", asyncRoute(controller.getFlightBooking));

  router.post("/hotels/search", asyncRoute(controller.searchHotels));
  router.get("/hotels/:hotelId", asyncRoute(controller.getHotelDetails));
  router.post("/hotels/price", asyncRoute(controller.priceHotel));
  router.post("/hotels/prepare-booking", asyncRoute(controller.prepareHotelBooking));
  router.get("/hotels/bookings/:bookingId", asyncRoute(controller.getHotelBooking));

  router.post("/stays/search", asyncRoute(controller.searchStays));
  router.post("/stays/rates", asyncRoute(controller.getStayRates));
  router.post("/stays/quotes", asyncRoute(controller.createStayQuote));
  router.post("/stays/prepare", asyncRoute(controller.createStayQuote));
  router.post("/stays/bookings", asyncRoute(controller.createStayBooking));
  router.post("/stays/confirm", asyncRoute(controller.createStayBooking));
  router.get("/stays/bookings/:bookingId", asyncRoute(controller.getStayBooking));

  return router;
}
