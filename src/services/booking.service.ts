import type {
  BookingRecord,
  BookingType,
  ConfirmFlightBookingInput,
  DuffelPassengerInput,
  RequestContext
} from "../models/types.js";
import { createId, mockDb, nowIso } from "../store/mock-db.js";
import { auditLog } from "../utils/audit-log.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors.js";
import type { TravelOrchestrator } from "./travel-orchestrator.service.js";

export interface PrepareBookingInput {
  type: BookingType;
  offerId: string;
  idempotencyKey?: string;
  passengers?: DuffelPassengerInput[];
  preparedSnapshot?: Record<string, unknown>;
}

export class BookingService {
  constructor(private readonly travelOrchestrator: TravelOrchestrator) {}

  prepare(input: PrepareBookingInput): BookingRecord {
    const pricedOffer =
      input.type === "flight"
        ? mockDb.pricedFlightOffers.get(input.offerId)
        : mockDb.pricedHotelOffers.get(input.offerId);

    if (!pricedOffer) {
      throw new NotFoundError("Priced offer not found. Price the offer before preparing a booking.");
    }

    const record: BookingRecord = {
      id: createId("booking"),
      type: input.type,
      offerId: input.offerId,
      provider: pricedOffer.provider,
      amount: pricedOffer.total.amount,
      currency: pricedOffer.total.currency,
      status: "pending",
      requiresUserConfirmation: true,
      userConfirmed: false,
      preparedSnapshot: {
        ...(input.preparedSnapshot ?? {}),
        passengers: input.passengers ?? []
      },
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    mockDb.bookings.set(record.id, record);
    auditLog({
      action: "booking.prepare",
      actor: "backend",
      targetId: record.id,
      metadata: {
        type: record.type,
        amount: record.amount,
        currency: record.currency,
        idempotencyKey: input.idempotencyKey
      }
    });
    return record;
  }

  get(bookingId: string): BookingRecord {
    const booking = mockDb.bookings.get(bookingId);
    if (!booking) {
      throw new NotFoundError("Booking not found");
    }
    return booking;
  }

  confirmUser(bookingId: string, userConfirmed: boolean): BookingRecord {
    if (!userConfirmed) {
      throw new ForbiddenError("User confirmation is required");
    }

    const booking = this.get(bookingId);
    if (booking.status !== "pending" && booking.status !== "user_confirmed") {
      throw new ValidationError(`Booking cannot be confirmed from status ${booking.status}`);
    }

    booking.userConfirmed = true;
    booking.status = "user_confirmed";
    booking.updatedAt = nowIso();
    auditLog({ action: "booking.user_confirm", actor: "user", targetId: booking.id });
    return booking;
  }

  async confirmSupplierBooking(input: {
    bookingId: string;
    userConfirmed: true;
    context: RequestContext;
    idempotencyKey: string;
    passengers?: DuffelPassengerInput[];
    orderType?: ConfirmFlightBookingInput["orderType"];
    payment?: ConfirmFlightBookingInput["payment"];
  }): Promise<BookingRecord> {
    const booking = this.confirmUser(input.bookingId, input.userConfirmed);
    const passengers = input.passengers ?? passengersFromSnapshot(booking.preparedSnapshot);
    mockDb.userConfirmations.push({
      id: createId("confirm"),
      bookingId: booking.id,
      userId: input.context.userId,
      tenantId: input.context.tenantId,
      action: "confirm",
      supplier: "duffel",
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso()
    });

    const supplierBooking =
      booking.type === "flight"
        ? await this.travelOrchestrator.confirmFlightBooking({
          offerId: booking.offerId,
          bookingId: booking.id,
          passengers,
          orderType: input.orderType ?? "hold",
          payment: input.payment,
          idempotencyKey: input.idempotencyKey,
          userConfirmed: true
        }, input.context)
        : await this.travelOrchestrator.createHotelBooking(booking.offerId, booking.id, input.context);

    booking.supplierBookingId = supplierBooking.supplierBookingId;
    booking.confirmationNumber = supplierBooking.confirmationNumber;
    booking.status = "supplier_confirmed";
    booking.supplierStatus = supplierBooking.status;
    booking.updatedAt = nowIso();
    auditLog({
      action: "booking.supplier_confirm",
      actor: "backend",
      targetId: booking.id,
      metadata: {
        type: booking.type,
        provider: booking.provider,
        idempotencyKey: input.idempotencyKey
      }
    });
    return booking;
  }

  async createSupplierBooking(bookingId: string, context: RequestContext): Promise<BookingRecord> {
    const booking = this.get(bookingId);
    if (!booking.userConfirmed) {
      throw new ForbiddenError("Supplier booking requires user confirmation");
    }
    if (booking.status !== "payment_succeeded" && booking.status !== "supplier_confirmed") {
      throw new ValidationError("Supplier booking requires successful payment first");
    }
    if (booking.supplierBookingId && booking.confirmationNumber) {
      return booking;
    }

    const supplierBooking =
      booking.type === "flight"
        ? await this.travelOrchestrator.createFlightBooking(booking.offerId, booking.id, context, {
          passengers: passengersFromSnapshot(booking.preparedSnapshot),
          orderType: "hold",
          idempotencyKey: booking.idempotencyKey
        })
        : await this.travelOrchestrator.createHotelBooking(booking.offerId, booking.id, context);

    booking.supplierBookingId = supplierBooking.supplierBookingId;
    booking.confirmationNumber = supplierBooking.confirmationNumber;
    booking.status = "supplier_confirmed";
    booking.updatedAt = nowIso();
    auditLog({
      action: "booking.supplier_confirm",
      actor: "backend",
      targetId: booking.id,
      metadata: { type: booking.type, provider: booking.provider }
    });
    return booking;
  }

  cancel(bookingId: string): BookingRecord {
    const booking = this.get(bookingId);
    booking.status = "cancelled";
    booking.updatedAt = nowIso();
    auditLog({ action: "booking.cancel", actor: "backend", targetId: booking.id });
    return booking;
  }
}

function passengersFromSnapshot(snapshot: BookingRecord["preparedSnapshot"]): DuffelPassengerInput[] {
  const passengers = snapshot?.passengers;
  return Array.isArray(passengers) ? passengers as DuffelPassengerInput[] : [];
}
