// CodeBlaze — server.js
// Express backend: Q&A, Forums, Live RSS Tech News, Advertise inquiries.
// Data persists to ./data/*.json (no database required).

const express = require('express');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- tiny JSON file store ----------
function load(name, fallback) {
  const file = path.join(DATA_DIR, name + '.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function save(name, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- seed data ----------
let questions = load('questions', [
  {
    id: 'q1', title: 'How do I reverse a string in Python?', body: 'Looking for the most Pythonic way.',
    tags: ['python'], author: 'devina', votes: 42, createdAt: '2026-07-01T10:00:00Z',
    answers: [
      { id: 'a1', body: 'Use slicing: `s[::-1]` — fastest and most idiomatic.', author: 'pyguru', votes: 58, accepted: true, createdAt: '2026-07-01T10:05:00Z' },
      { id: 'a2', body: '`"".join(reversed(s))` also works and reads clearly.', author: 'lambda_larry', votes: 12, accepted: false, createdAt: '2026-07-01T11:00:00Z' }
    ]
  },
  {
    id: 'q2', title: 'What is the difference between == and === in JavaScript?', body: 'When should I use each?',
    tags: ['javascript'], author: 'jsnewbie', votes: 35, createdAt: '2026-07-02T09:00:00Z',
    answers: [
      { id: 'a3', body: '`===` compares value AND type (strict). `==` coerces types first. Always prefer `===`.', author: 'es_ninja', votes: 44, accepted: true, createdAt: '2026-07-02T09:10:00Z' }
    ]
  },
  {
    id: 'q3', title: 'Rust borrow checker: cannot borrow as mutable more than once', body: 'Getting E0499. How do I restructure my code?',
    tags: ['rust'], author: 'crab_fan', votes: 18, createdAt: '2026-07-05T14:00:00Z', answers: []
  }
]);

let threads = load('threads', [
  {
    id: 't1', title: 'Show off your dev setup 2026', category: 'General', author: 'setup_addict',
    createdAt: '2026-06-28T08:00:00Z', views: 1204,
    posts: [
      { id: 'p1', body: 'M4 MacBook + dual 4K monitors + split keyboard. AMA.', author: 'setup_addict', createdAt: '2026-06-28T08:00:00Z' },
      { id: 'p2', body: 'Linux + tiling WM gang, still undefeated for productivity.', author: 'arch_btw', createdAt: '2026-06-28T09:30:00Z' }
    ]
  },
  {
    id: 't2', title: 'Is AI pair programming making juniors weaker?', category: 'Career', author: 'senior_sam',
    createdAt: '2026-07-03T12:00:00Z', views: 3567,
    posts: [
      { id: 'p3', body: 'Hot take: juniors who lean on AI never learn to debug. Discuss.', author: 'senior_sam', createdAt: '2026-07-03T12:00:00Z' },
      { id: 'p4', body: 'Counter-take: calculators didn\'t kill math. Tools shift what "fundamentals" means.', author: 'optimist_omar', createdAt: '2026-07-03T13:15:00Z' }
    ]
  },
  {
    id: 't3', title: 'Best resources to learn Go in 2026?', category: 'Learning', author: 'gopher_wannabe',
    createdAt: '2026-07-06T10:00:00Z', views: 842,
    posts: [
      { id: 'p5', body: 'Go by Example + the official tour, then build a CLI tool. Worked for me.', author: 'gopher_wannabe', createdAt: '2026-07-06T10:00:00Z' }
    ]
  }
]);

let adInquiries = load('ad_inquiries', []);

// ---------- Advertise packages ($100–$999, category-wise) ----------
const AD_PACKAGES = [
  { id: 'sidebar', category: 'Display', name: 'Sidebar Banner', price: 100, period: '/month', desc: '300×250 banner on all article and Q&A pages.', perks: ['~500K impressions/mo', 'Link + image', 'Basic analytics'] },
  { id: 'newsletter', category: 'Newsletter', name: 'Newsletter Mention', price: 199, period: '/issue', desc: 'A featured blurb in our weekly dev newsletter.', perks: ['120K subscribers', '40% open rate', 'One link + 50 words'] },
  { id: 'qa-sponsor', category: 'Q&A', name: 'Sponsored Q&A Tag', price: 299, period: '/month', desc: 'Your brand pinned on a language tag page (e.g., #python).', perks: ['Tag-page takeover', 'Logo + tagline', 'Click tracking'] },
  { id: 'forum-pin', category: 'Forums', name: 'Pinned Forum Thread', price: 399, period: '/month', desc: 'A pinned, labeled sponsor thread in a forum category.', perks: ['Direct community access', 'AMA support', 'Moderation included'] },
  { id: 'news-slot', category: 'News', name: 'Tech News Sponsor Slot', price: 499, period: '/month', desc: 'Your card inside the live news feed (clearly labeled).', perks: ['Native placement', 'Rotates hourly', 'CTR reports'] },
  { id: 'home-banner', category: 'Display', name: 'Homepage Hero Banner', price: 599, period: '/month', desc: 'Premium 970×250 banner on the homepage.', perks: ['~2M impressions/mo', 'Top-of-fold', 'A/B creative rotation'] },
  { id: 'article', category: 'Content', name: 'Sponsored Article', price: 799, period: '/post', desc: 'A full technical article written with our editors.', perks: ['SEO-optimized', 'Permanent link', 'Social promotion'] },
  { id: 'takeover', category: 'Premium', name: 'Full Site Takeover', price: 999, period: '/week', desc: 'All banner slots + newsletter + pinned thread for one week.', perks: ['Every display slot', 'Newsletter feature', 'Pinned forum thread', 'Dedicated manager'] }
];

// ---------- RSS news ----------
const parser = new Parser({ timeout: 10000 });
const FEEDS = [
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { name: 'Dev.to', url: 'https://dev.to/feed' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
  { name: 'freeCodeCamp', url: 'https://www.freecodecamp.org/news/rss/' },
  { name: 'GeeksforGeeks', url: 'https://www.geeksforgeeks.org/feed/' },
  { name: 'TechGig', url: 'https://content.techgig.com/rssfeedstopstories.cms' },
  { name: 'Scaler', url: 'https://www.scaler.com/blog/feed/' },
  { name: 'takeUforward', url: 'https://takeuforward.org/feed/' }
];

let newsCache = { items: [], fetchedAt: 0 };
const NEWS_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchNews() {
  const results = await Promise.allSettled(FEEDS.map(async f => {
    const feed = await parser.parseURL(f.url);
    return (feed.items || []).slice(0, 10).map(i => ({
      source: f.name,
      title: i.title || '',
      link: i.link || '',
      date: i.isoDate || i.pubDate || null,
      snippet: (i.contentSnippet || '').slice(0, 220)
    }));
  }));
  const items = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const failed = results.map((r, i) => r.status === 'rejected' ? FEEDS[i].name : null).filter(Boolean);
  return { items, failed };
}

app.get('/api/news', async (req, res) => {
  try {
    if (Date.now() - newsCache.fetchedAt > NEWS_TTL || !newsCache.items.length) {
      const { items, failed } = await fetchNews();
      newsCache = { items: items.length ? items : newsCache.items, fetchedAt: Date.now(), failed };
    }
    res.json({ items: newsCache.items, fetchedAt: newsCache.fetchedAt, failedFeeds: newsCache.failed || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch news', detail: e.message });
  }
});

// ---------- Q&A ----------
app.get('/api/questions', (req, res) => {
  const { tag, q } = req.query;
  let list = questions;
  if (tag) list = list.filter(x => x.tags.includes(String(tag).toLowerCase()));
  if (q) list = list.filter(x => (x.title + x.body).toLowerCase().includes(String(q).toLowerCase()));
  res.json(list);
});

app.post('/api/questions', (req, res) => {
  const { title, body, tags, author } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  const question = {
    id: uid(), title: String(title).slice(0, 200), body: String(body).slice(0, 5000),
    tags: (Array.isArray(tags) ? tags : String(tags || '').split(',')).map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 5),
    author: String(author || 'anonymous').slice(0, 40), votes: 0, answers: [], createdAt: new Date().toISOString()
  };
  questions.unshift(question);
  save('questions', questions);
  res.status(201).json(question);
});

app.post('/api/questions/:id/answers', (req, res) => {
  const q = questions.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'question not found' });
  const { body, author } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  const answer = { id: uid(), body: String(body).slice(0, 5000), author: String(author || 'anonymous').slice(0, 40), votes: 0, accepted: false, createdAt: new Date().toISOString() };
  q.answers.push(answer);
  save('questions', questions);
  res.status(201).json(answer);
});

app.post('/api/questions/:id/vote', (req, res) => {
  const q = questions.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'question not found' });
  q.votes += req.body && req.body.dir === 'down' ? -1 : 1;
  save('questions', questions);
  res.json({ votes: q.votes });
});

// ---------- Forums ----------
app.get('/api/forums', (req, res) => {
  const { category } = req.query;
  let list = threads;
  if (category) list = list.filter(t => t.category.toLowerCase() === String(category).toLowerCase());
  res.json(list.map(({ posts, ...t }) => ({ ...t, replies: posts.length - 1 >= 0 ? posts.length - 1 : 0 })));
});

app.get('/api/forums/:id', (req, res) => {
  const t = threads.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'thread not found' });
  t.views++;
  save('threads', threads);
  res.json(t);
});

app.post('/api/forums', (req, res) => {
  const { title, body, category, author } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  const thread = {
    id: uid(), title: String(title).slice(0, 200), category: String(category || 'General').slice(0, 40),
    author: String(author || 'anonymous').slice(0, 40), createdAt: new Date().toISOString(), views: 0,
    posts: [{ id: uid(), body: String(body).slice(0, 5000), author: String(author || 'anonymous').slice(0, 40), createdAt: new Date().toISOString() }]
  };
  threads.unshift(thread);
  save('threads', threads);
  res.status(201).json(thread);
});

app.post('/api/forums/:id/posts', (req, res) => {
  const t = threads.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'thread not found' });
  const { body, author } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  const post = { id: uid(), body: String(body).slice(0, 5000), author: String(author || 'anonymous').slice(0, 40), createdAt: new Date().toISOString() };
  t.posts.push(post);
  save('threads', threads);
  res.status(201).json(post);
});

// ---------- Stack Overflow (Stack Exchange API) ----------
const SO_API = 'https://api.stackexchange.com/2.3';
let soCache = {}; // key -> { data, fetchedAt }
const SO_TTL = 10 * 60 * 1000;

function mapSoQuestion(q) {
  return {
    id: q.question_id,
    title: q.title,
    link: q.link,
    tags: q.tags || [],
    votes: q.score,
    answers: q.answer_count,
    answered: q.is_answered,
    views: q.view_count,
    author: q.owner ? q.owner.display_name : 'unknown',
    createdAt: q.creation_date ? new Date(q.creation_date * 1000).toISOString() : null
  };
}

app.get('/api/so', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const tag = String(req.query.tag || '').trim().slice(0, 40);
  const key = `q=${q}|tag=${tag}`;
  try {
    const cached = soCache[key];
    if (cached && Date.now() - cached.fetchedAt < SO_TTL) return res.json(cached.data);

    let url;
    if (q) {
      url = `${SO_API}/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=20&filter=default`;
    } else if (tag) {
      url = `${SO_API}/questions?order=desc&sort=hot&tagged=${encodeURIComponent(tag)}&site=stackoverflow&pagesize=20`;
    } else {
      url = `${SO_API}/questions?order=desc&sort=hot&site=stackoverflow&pagesize=20`;
    }
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`Stack Exchange API returned ${r.status}`);
    const body = await r.json();
    const data = { items: (body.items || []).map(mapSoQuestion), quotaRemaining: body.quota_remaining };
    soCache[key] = { data, fetchedAt: Date.now() };
    if (Object.keys(soCache).length > 50) soCache = { [key]: soCache[key] }; // crude cap
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to reach Stack Overflow', detail: e.message });
  }
});

// ---------- Advertise ----------
app.get('/api/ads/packages', (req, res) => res.json(AD_PACKAGES));

app.post('/api/ads/inquiries', (req, res) => {
  const { packageId, company, email, message } = req.body || {};
  const pkg = AD_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: 'invalid packageId' });
  if (!company || !email) return res.status(400).json({ error: 'company and email are required' });
  const inquiry = { id: uid(), packageId, package: pkg.name, price: pkg.price, company: String(company).slice(0, 100), email: String(email).slice(0, 100), message: String(message || '').slice(0, 2000), createdAt: new Date().toISOString() };
  adInquiries.push(inquiry);
  save('ad_inquiries', adInquiries);
  res.status(201).json({ ok: true, id: inquiry.id, note: `Thanks ${inquiry.company}! We'll reach out about the ${pkg.name} ($${pkg.price}${pkg.period}).` });
});

// ---------- Languages knowledge ----------
app.get('/api/languages', (req, res) => {
  res.json(load('languages', []));
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🔥 CodeBlazeFeed running at http://localhost:${PORT}`));
