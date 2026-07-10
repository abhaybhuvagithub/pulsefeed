# CodeBlazeFeed 🔥

The hottest programming hub: language tips & tricks, community Q&A, developer forums, live world tech news from popular RSS feeds, and an Advertise With Us section ($100–$999, category-wise).

https://codeblaze-eng9.onrender.com/

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

Requires Node.js 18+.

## Features

- **Languages** — knowledge cards for 13 languages (Python, JS, TS, Java, C++, Go, Rust, C#, PHP, Swift, Kotlin, SQL, Ruby) with tips, tricks, and snippets. Edit `data/languages.json` to add more.
- **Q&A** — ask questions, post answers, upvote, search, tags. Persists to `data/questions.json`.
- **Forums** — categories (General / Career / Learning), threads, replies, view counts. Persists to `data/threads.json`.
- **Tech News** — live RSS from 15 sources: Hacker News, Dev.to, TechCrunch, The Verge, Ars Technica, Wired, freeCodeCamp, GeeksforGeeks, TechGig, Scaler, takeUforward, MakeUseOf, Medium, Business Insider, and Gartner. Cached 10 min. Edit `FEEDS` in `server.js` to add feeds.
- **Advertise** — 8 packages from $100 to $999 across Display, Newsletter, Q&A, Forums, News, Content, and Premium categories. Inquiries persist to `data/ad_inquiries.json`.
- **Blaze — Agentic AI ad assistant** — a chat agent on the Advertise page that takes a campaign brief (goal + budget + optional target tag), scores every package against its own rules, recommends the best fit, then books it while enforcing placement rules (copy word/link limits, required language tag, creative requirements). Rules live in `AD_RULES` in `server.js`.
- **Dark / light theme** — toggle in the top bar (🌙 / ☀️). Remembers your choice in `localStorage` and defaults to your OS preference. Theme is applied before first paint (no flash).

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/news` | Aggregated RSS news |
| GET | `/api/questions?q=&tag=` | List/search questions |
| POST | `/api/questions` | Ask question |
| POST | `/api/questions/:id/answers` | Answer |
| POST | `/api/questions/:id/vote` | Upvote/downvote |
| GET | `/api/forums?category=` | List threads |
| GET | `/api/forums/:id` | Thread + posts |
| POST | `/api/forums` | New thread |
| POST | `/api/forums/:id/posts` | Reply |
| GET | `/api/ads/packages` | Ad packages |
| POST | `/api/ads/assistant/recommend` | Rank packages for a `{text\|goals, budget, tag}` brief |
| POST | `/api/ads/assistant/validate` | Check draft copy against a package's rules |
| POST | `/api/ads/inquiries` | Book a package (runs rule validation, returns warnings/notes) |
| GET | `/api/languages` | Language knowledge |

## Booking emails (Gmail SMTP)

When a package is booked, the server emails the site owner an alert and the
customer a confirmation. This is off until you set three env vars:

| Env var | Value |
|---|---|
| `GMAIL_USER` | the Gmail address you send from (e.g. `abhay.bhuva@gmail.com`) |
| `GMAIL_APP_PASSWORD` | a Google **App Password** (16 chars) — not your normal password |
| `OWNER_EMAIL` | where booking alerts go (defaults to `abhay.bhuva@gmail.com`) |

Create an App Password at https://myaccount.google.com/apppasswords (requires
2-Step Verification enabled). If the vars are unset, bookings still work — email
is simply skipped and a warning is logged.

## Notes

- Data is stored as JSON files in `data/` — swap in a real DB (Postgres/Mongo) for production. On hosts with an ephemeral filesystem (e.g. Render free tier) `data/*.json` resets on redeploy; email + a real DB are the durable path for bookings.
- No auth yet; add sessions/JWT before going live.
- Deploy anywhere Node runs (Render, Railway, Fly.io, a VPS).
