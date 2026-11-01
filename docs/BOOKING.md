# Hand-over booking

## The flow

1. Run a check on the desk. When a verdict appears, the **Hand it over** panel opens under the safer-routes panel.
2. Choose where to search: your browser location, your area by name, or the shipment origin.
3. Read the ranked list. Each row shows distance, address, rating (or "No rating on file") and a fit score; the map marks the same places. Selecting one shows the score breakdown and flags such as "Services unverified".
4. Pick a hand-over time. Opening hours are re-checked against it and the ranking updates.
5. Review the pre-filled form (cargo, name, phone, email), read Dhruva's opinion, tick the approval box, and place the booking.
6. You land on a slip with the agency, the time, directions, a calendar file, a print view and a WhatsApp share link. If you gave an email and Resend is configured, you also get a confirmation by email.
7. Bring the parcel to the agency in the hand-over window (default 60 minutes) and show the slip.

A first-visit prompt offers to save your name, email and phone on this device so steps 5 and 6 are pre-filled. It can be skipped and is never shown twice.

## What a booking is, and is not

A booking is a signed record of the plan you approved. Dhruva has no system link to any agency, so the agency learns of it when you arrive or share the slip. Payment is made at the counter at the agency's price.

## Fit score

| Part | Points | Evidence |
|---|---|---|
| Distance | 30 | Straight-line km, zero at 20 km |
| Service fit | 25 | Carrier catalog against what the shipment needs; unbranded agencies get 10 |
| Listing details | 20 | Phone, hours, website, address, name |
| Open at your time | 10 | Parsed OSM `opening_hours`; skipped when unreadable |
| Reputation | 15 | Google rating pulled toward 3.8 by a prior of ten reviews; skipped without a key |

## Deploying

Set `ORDER_SECRET` (sensitive, production). Optionally set `GOOGLE_MAPS_API_KEY` to enable ratings and `RESEND_API_KEY` plus `RESEND_FROM` for email. Without them the flow still works and says what is missing.

## Limits

Bookings cannot be edited; place a new one. Slots are limited to the next 90 days. Times are the agency's local time as entered.
