# Ctrip TourAPI Probe

- Generated: 2026-06-21T22:51:52.965Z
- Generated Shanghai: 2026/6/22 06:51:52
- Attempts: 2
- Successful attempts: 0
- Decision: abandon_this_integration_attempt
- Reason: The provided Ctrip category roots did not return success-class API responses. Per project rule, after two unsuccessful connection attempts this Ctrip API integration attempt is abandoned and no runtime provider is enabled.

## Endpoints

| Environment | URL | OK | HTTP | Content-Type | Preview |
| --- | --- | --- | --- | --- | --- |
| fat | https://tourapi-fat.ctripqa.com/api/BasicInfo/ | no | 404 | application/json;charset=UTF-8 | {"timestamp":1782082284928,"status":404,"error":"Not Found","message":"No message available","path":"/api/BasicInfo/"} |
| production | http://tourapi.ctrip.com/api/BasicInfo/ | no | 404 | text/html | <!doctype html><html><head><meta charset=utf-8><meta http-equiv=X-UA-Compatible content="IE=edge"><meta name=robots content="noindex, nofollow"><meta content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,minimal-ui" name=viewport><title> |

## Boundaries

- This probe does not send traveler identity, phone, email, passport, payment, login, or order data.
- This probe does not create a Ctrip order.
- Anna remains Duffel-only for structured flight/hotel booking until a usable Ctrip interface contract and credentials are available.

