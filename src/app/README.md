# src/app

Next.js App Router. Each folder is a route.

| Path | What it is |
|---|---|
| `page.tsx` | Landing page (globe and scroll story) |
| `desk/` | The desk. Reads `?q=` to pre-fill a shipment sentence |
| `order/[token]/` | Hand-over slip for a signed booking; `noindex`, printable |
| `api/analyze` | Streams the multi-agent check as NDJSON |
| `api/agencies` | Ranked hand-over agencies near a point |
| `api/orders`, `api/orders/[token]` | Create a signed booking; download its calendar file |
| `api/places`, `api/route` | Place search; road geometry |
| `api/pulse`, `api/health` | Live feed status |
| `globals.css`, `agents.css`, `globe-labels.css`, `handover.css` | Styles. Colour and spacing tokens live in `:root` in `globals.css` |

Route `params` are a Promise in this Next.js version.
