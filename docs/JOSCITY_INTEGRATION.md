# JOSCITY.com – Implement events from this Ticketing platform

Use this document in the **joscity.com codebase** to implement events: joscity **calls this Ticketing platform’s API** to fetch events and show them (with links to buy tickets on the Ticketing site). All information needed to integrate is below.

---

## 1. Endpoint to call

| Purpose | Method | URL |
|--------|--------|-----|
| **Get events for JOSCITY** (ready-shaped list) | **GET** | `https://ticketing-back.onrender.com/api/events/feed/joscity` |

Replace the host with your Ticketing backend URL if different. No query params required.

---

## 2. Response format

**Content-Type:** `application/json`  
**Body:** JSON **array** of event objects. Each object has:

| Field              | Type   | Required | Description |
|--------------------|--------|----------|-------------|
| `event_id`         | number | Yes      | Unique numeric ID (derived from our internal ID). |
| `event_title`      | string | Yes      | Title. |
| `event_description`| string | No       | Description (plain or HTML). |
| `event_category`   | string | No       | e.g. "Music", "Food", "Sport". |
| `event_date`       | string | Yes      | ISO 8601 datetime, e.g. `2025-03-01T18:00:00.000Z`. |
| `event_location`   | string | No       | Venue or address. |
| `event_cover`      | string | No       | Full URL to cover image. |
| `event_capacity`   | number | No       | Max attendees (sum of ticket type quantities). Omitted if 0. |
| `source`           | string | Yes      | Always `"gatewav"` so JOSCITY can label external events. |

Example:

```json
[
  {
    "event_id": 123456789012,
    "event_title": "Live Concert",
    "event_description": "An amazing night of music.",
    "event_category": "Music",
    "event_date": "2025-03-15T19:00:00.000Z",
    "event_location": "Main Arena, Lagos",
    "event_cover": "https://images.unsplash.com/photo-...",
    "event_capacity": 500,
    "source": "gatewav"
  }
]
```

---

## 3. Linking to Ticketing for ticket purchase

To send users from JOSCITY to the Ticketing platform to view an event and buy tickets:

- **URL pattern:** `{TICKETING_FRONTEND_BASE}/event/{event_uuid}`
- The feed returns numeric **`event_id`** (for display only). The Ticketing app uses **string UUIDs** (`id`) in event URLs. To build the link you need the UUID:

  **Option A:** Call the raw Events API (section 5) and use each event's **`id`** (string UUID) in the link.  
  **Option B:** Your JOSCITY backend fetches both the feed and the raw list once and stores a mapping `event_id` → `id`; then use the stored `id` for links.

**Example Ticketing frontend base URL (replace with yours):**  
`https://gatewav.com` or your Ticketing app domain.

**Example link:**  
`https://gatewav.com/event/a1b2c3d4-e5f6-7890-abcd-ef1234567890`

---

## 4. CORS

- If **JOSCITY’s frontend** calls this URL from the browser, our backend must allow their origin.
- Add JOSCITY’s domain to the allowed CORS origins, e.g. in env:
  - `CORS_ORIGIN=https://gatewav.com,https://joscity.com,https://www.joscity.com`
- If only **JOSCITY’s backend** calls our API (server-to-server), CORS is not required.

---

## 5. Optional – API key

- If you set `JOSCITY_API_KEY` in the backend env, this endpoint **requires** an API key.
- JOSCITY can send it in either form:
  - Header: **`X-API-Key: <your-key>`**
  - Or: **`Authorization: Bearer <your-key>`**
- If the key is missing or wrong, the response is **401** with `{ "error": "Invalid or missing API key" }`.
- If `JOSCITY_API_KEY` is not set, the endpoint is public (no key required).

**Example (JOSCITY server):** Store the key in env (e.g. `TICKETING_JOSCITY_API_KEY`) and send: `X-API-Key: <key>` or `Authorization: Bearer <key>`.

---

## 6. Raw Events API (for "Buy tickets" links)

To get the **event UUID** (`id`) for building `/event/{id}` links on the Ticketing site:

| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| **GET** | `https://ticketing-back.onrender.com/api/events` | No | List all events. Each has `id` (string UUID), `title`, `date`, `venue`, `imageUrl`, `tickets`, etc. |
| **GET** | `https://ticketing-back.onrender.com/api/events/:id` | No | Single event by UUID (includes ticket types). |

Use each event's **`id`** in: `{TICKETING_FRONTEND_BASE}/event/{id}`.

---

## 7. Summary for JOSCITY implementation

| Item | Value |
|------|--------|
| **Endpoint** | `GET https://ticketing-back.onrender.com/api/events/feed/joscity` |
| **Response** | JSON array of events (shape above). |
| **CORS** | Add our backend’s allowed origins to include JOSCITY’s domain if calling from browser. |
| **API key (optional)** | Set on our side; JOSCITY sends `X-API-Key` or `Authorization: Bearer <key>`. |
| **Ticket link** | `{TICKETING_FRONTEND_BASE}/event/{uuid}` — get UUID from `GET /api/events` (field `id`). |

---

## 8. Troubleshooting 404 on the feed

If JOSCITY gets **404** when calling the Ticketing feed:

| Cause | What to do |
|-------|------------|
| **Feed route not deployed** | The Ticketing backend must expose `GET /api/events/feed/joscity`. Redeploy the Ticketing backend so the latest code (with this route) is live. |
| **Wrong base URL** | JOSCITY must call the **actual** Ticketing API base URL. Set it in JOSCITY env, e.g. `TICKETING_FEED_URL=https://your-actual-ticketing-api.com/api/events/feed/joscity` (no trailing slash). Use the same host as your deployed Ticketing backend (e.g. Render, DigitalOcean). |
| **Wrong path** | URL must end with `/api/events/feed/joscity` (not `/api/events` or `/api/events/feed`). |

**Verify the Ticketing API:**  
Open `GET https://<your-ticketing-backend>/api` in a browser or with curl. The JSON response should list `endpoints` including `"/api/events/feed/joscity"`. If it’s missing, the deployed backend doesn’t have the feed route — redeploy.

---

## 9. Checklist for JOSCITY codebase

- [ ] Set `TICKETING_FEED_URL` to the full feed URL (e.g. `https://your-ticketing-api.com/api/events/feed/joscity`).
- [ ] Call `GET TICKETING_FEED_URL` (no query params).
- [ ] If API key required: send header `X-API-Key` or `Authorization: Bearer <key>`.
- [ ] Parse JSON; use `event_id`, `event_title`, `event_date`, `event_location`, `event_cover`, `event_capacity`, `source`.
- [ ] For "Buy tickets": call `GET /api/events` and use each event's `id` in `{TICKETING_FRONTEND_BASE}/event/{id}`.
- [ ] If calling from frontend: add JOSCITY origin to Ticketing backend `CORS_ORIGIN`.
- [ ] If you get 404: confirm Ticketing backend is deployed and `GET <TICKETING_API>/api` lists `"/api/events/feed/joscity"`.
