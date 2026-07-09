# CodeBlazeFeed 🔥

The hottest programming hub: language tips & tricks, community Q&A, developer forums, live world tech news from popular RSS feeds, and an Advertise With Us section ($100–$999, category-wise).

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
- **Tech News** — live RSS from Hacker News, Dev.to, TechCrunch, The Verge, Ars Technica, Wired, freeCodeCamp. Cached 10 min. Edit `FEEDS` in `server.js` to add feeds.
- **Advertise** — 8 packages from $100 to $999 across Display, Newsletter, Q&A, Forums, News, Content, and Premium categories. Inquiries persist to `data/ad_inquiries.json`.

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
| POST | `/api/ads/inquiries` | Book a package |
| GET | `/api/languages` | Language knowledge |

## Notes

- Data is stored as JSON files in `data/` — swap in a real DB (Postgres/Mongo) for production.
- No auth yet; add sessions/JWT before going live.
- Deploy anywhere Node runs (Render, Railway, Fly.io, a VPS).
