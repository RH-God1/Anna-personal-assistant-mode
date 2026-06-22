# Generated file. Do not edit.
from __future__ import annotations
from typing import NotRequired, TypedDict

class Passengers(TypedDict):
    adults: int
    children: int

class SearchQuery(TypedDict):
    product: str
    origin: NotRequired[str | None]
    destination: NotRequired[str | None]
    departureDate: str
    passengers: Passengers

class Offer(TypedDict):
    id: str
    title: str
    schedule: str
    price: float | None
    canAutoBook: bool

class Run(TypedDict):
    id: str
    state: str
    nextGate: str | None
    query: SearchQuery
    selectedOffer: Offer

class StartRunInput(TypedDict):
    product: str
    provider: str
    search: SearchQuery

StartRunOutput = Run

class ContinueInput(TypedDict):
    run_id: str
    event: str

ContinueOutput = Run
