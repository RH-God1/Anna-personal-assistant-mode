// Generated file. Do not edit.
export const toolName = "travel_agent";
export const actionExamples = {
  "start_run": {
    "id": "run_example",
    "state": "await_traveler_info",
    "nextGate": "traveler_info",
    "query": {
      "product": "flight",
      "origin": "SHA",
      "destination": "BJS",
      "departureDate": "2026-07-01",
      "passengers": {
        "adults": 1,
        "children": 0
      }
    },
    "selectedOffer": {
      "id": "flight-sandbox-1",
      "title": "Sandbox 机票推荐方案",
      "schedule": "SHA → BJS · 2026-07-01",
      "price": 680,
      "canAutoBook": false
    }
  },
  "continue": {
    "id": "run_example",
    "state": "await_payment",
    "nextGate": "payment",
    "query": {
      "product": "flight",
      "origin": "SHA",
      "destination": "BJS",
      "departureDate": "2026-07-01",
      "passengers": {
        "adults": 1,
        "children": 0
      }
    },
    "selectedOffer": {
      "id": "flight-sandbox-1",
      "title": "Sandbox 机票推荐方案",
      "schedule": "SHA → BJS · 2026-07-01",
      "price": 680,
      "canAutoBook": false
    }
  }
};

export function mockInvoke(args) {
  if (!(args.action in actionExamples)) throw new Error(`Unknown action: ${args.action}`);
  return structuredClone(actionExamples[args.action]);
}
