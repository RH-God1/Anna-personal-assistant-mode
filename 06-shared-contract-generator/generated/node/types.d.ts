// Generated file. Do not edit.

export interface Passengers {
  adults: number;
  children: number;
}

export interface SearchQuery {
  product: string;
  origin?: string | null;
  destination?: string | null;
  departureDate: string;
  passengers: Passengers;
}

export interface Offer {
  id: string;
  title: string;
  schedule: string;
  price: number | null;
  canAutoBook: boolean;
}

export interface Run {
  id: string;
  state: string;
  nextGate: string | null;
  query: SearchQuery;
  selectedOffer: Offer;
}

export interface StartRunInput {
  product: string;
  provider: string;
  search: SearchQuery;
}

export type StartRunOutput = Run;

export interface ContinueInput {
  run_id: string;
  event: string;
}

export type ContinueOutput = Run;

export type ActionName = "start_run" | "continue";

