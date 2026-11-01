# Security

## Reporting a vulnerability

Email rohithsuresh2107@gmail.com with a description and steps to reproduce. Please do not open a public issue for security problems. Expect a first reply within a few days.

## What is sensitive here

- `ORDER_SECRET` seals booking links. Anyone holding it can forge a booking slip. Store it as a sensitive variable and rotate it if it leaks; rotating invalidates existing links.
- A booking link contains the sender's name, optional phone and email, and the shipment. Treat links like documents: anyone with the link can read it. The slip page is marked `noindex`.
- The sender profile is stored only in the browser's `localStorage`. Dhruva has no accounts and no database.

## Design choices that limit exposure

- Booking input is validated with zod and bounded (lengths, ranges, a 90-day window); the seal is an HMAC-SHA256 checked in constant time.
- Upstream feeds are fetched server-side with timeouts; the browser never receives an API key.
- No payment details are collected. Payment happens at the agency counter.
