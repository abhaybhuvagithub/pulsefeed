// PulseFeed — server.js
// Express backend: Q&A, Forums, Live RSS Tech News, Advertise inquiries.
// Data persists to ./data/*.json (no database required).

const express = require('express');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // htmx posts form-encoded data

// ---------- Cache-busting ----------
// A fresh BUILD_ID each server start (i.e. each deploy). We rewrite the HTML so
// app.js / styles.css carry ?v=<BUILD_ID>, forcing browsers to fetch the new
// files after a deploy instead of serving a stale cached copy.
const BUILD_ID = Date.now().toString(36);
function sendIndex(req, res) {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html
      .replace(/href="styles\.css(?:\?[^"]*)?"/, `href="styles.css?v=${BUILD_ID}"`)
      .replace(/src="app\.js(?:\?[^"]*)?"/, `src="app.js?v=${BUILD_ID}"`);
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (e) {
    res.status(500).send('index unavailable');
  }
}
app.get('/', sendIndex);
app.get('/index.html', sendIndex);

// Static assets: versioned files (?v=) can be cached hard; everything else revalidates.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(js|css)$/.test(filePath)) res.set('Cache-Control', 'no-cache');
  }
}));

// ---------- Email (Gmail SMTP) ----------
// Enabled only when GMAIL_USER + GMAIL_APP_PASSWORD are set (App Password, not
// your normal Google password). If unset, bookings still work — emails are
// simply skipped and a warning is logged. OWNER_EMAIL gets the booking alerts.
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'abhay.bhuva@gmail.com';
const MAIL_USER = process.env.GMAIL_USER || '';
let mailer = null;
if (MAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
  mailer.verify()
    .then(() => console.log(`✉️  Email ready — sending as ${MAIL_USER}, alerts to ${OWNER_EMAIL}`))
    .catch(err => console.warn('✉️  Email config present but verify failed:', err.message));
} else {
  console.warn('✉️  Email disabled — set GMAIL_USER and GMAIL_APP_PASSWORD env vars to enable booking emails.');
}

// Send an owner alert + a customer confirmation for a booking. Never throws.
async function sendBookingEmails(inquiry, pkg) {
  if (!mailer) return { sent: false, reason: 'not configured' };
  const money = `$${pkg.price}${pkg.period}`;
  const detail = [
    `Package: ${pkg.name} (${money})`,
    `Company: ${inquiry.company}`,
    `Contact: ${inquiry.email}`,
    inquiry.goal ? `Goal: ${inquiry.goal}` : null,
    inquiry.budget != null ? `Budget: $${inquiry.budget}` : null,
    inquiry.tag ? `Target tag: #${inquiry.tag}` : null,
    inquiry.copy ? `Ad copy: ${inquiry.copy}` : null
  ].filter(Boolean).join('\n');
  const warns = (inquiry.validation && inquiry.validation.warnings) || [];

  try {
    // 1) Owner alert
    await mailer.sendMail({
      from: `"PulseFeed Ads" <${MAIL_USER}>`,
      to: OWNER_EMAIL,
      replyTo: inquiry.email,
      subject: `🔥 New ad booking: ${pkg.name} — ${inquiry.company}`,
      text: `New advertising booking on PulseFeed:\n\n${detail}\n` +
        (warns.length ? `\n⚠️ Rule flags:\n- ${warns.join('\n- ')}\n` : '') +
        `\nInquiry ID: ${inquiry.id}\nReceived: ${inquiry.createdAt}`
    });
    // 2) Customer confirmation
    await mailer.sendMail({
      from: `"PulseFeed" <${MAIL_USER}>`,
      to: inquiry.email,
      replyTo: OWNER_EMAIL,
      subject: `Your ${pkg.name} booking with PulseFeed`,
      text: `Hi ${inquiry.company},\n\nThanks for booking the ${pkg.name} (${money}) on PulseFeed! ` +
        `We've received your request and our team will reach out shortly to finalise creative and scheduling.\n\n` +
        `Summary:\n${detail}\n` +
        (warns.length ? `\nA couple of things to tidy up before we go live:\n- ${warns.join('\n- ')}\n` : '') +
        `\nReply to this email if you have any questions.\n\n— The PulseFeed Team`,
      html: `<p>Hi <strong>${inquiry.company}</strong>,</p>
<p>Thanks for booking the <strong>${pkg.name}</strong> (${money}) on PulseFeed! We've received your request and our team will reach out shortly to finalise creative and scheduling.</p>
<p><strong>Summary</strong><br>${detail.replace(/\n/g, '<br>')}</p>
${warns.length ? `<p><strong>A couple of things to tidy up before we go live:</strong><br>- ${warns.join('<br>- ')}</p>` : ''}
<p>Reply to this email if you have any questions.</p>
<p>— The PulseFeed Team</p>`
    });
    return { sent: true };
  } catch (e) {
    console.error('✉️  Booking email failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

// Send a welcome email to a new newsletter subscriber + notify the owner. Never throws.
async function sendSubscribeEmails(sub) {
  if (!mailer) return { sent: false, reason: 'not configured' };
  try {
    // 1) Owner alert
    await mailer.sendMail({
      from: `"PulseFeed" <${MAIL_USER}>`,
      to: OWNER_EMAIL,
      subject: `🔔 New PulseFeed subscriber: ${sub.email}`,
      text: `New newsletter subscriber on PulseFeed:\n\nEmail: ${sub.email}\nSource: ${sub.source || 'site'}\nWhen: ${sub.createdAt}\n\nTotal subscribers: ${subscribers.length}`
    });
    // 2) Welcome to the subscriber
    await mailer.sendMail({
      from: `"PulseFeed 🔥" <${MAIL_USER}>`,
      to: sub.email,
      replyTo: OWNER_EMAIL,
      subject: `Welcome to PulseFeed 🔥`,
      text: `Hi there,\n\nThanks for subscribing to PulseFeed — your hub for programming, tech news, and curated learning resources.\n\n` +
        `You'll get our best links, feeds, and updates straight to your inbox. No spam, unsubscribe anytime.\n\n` +
        `See what's live: https://codeblaze-eng9.onrender.com/\n\n— The PulseFeed Team`,
      html: `<p>Hi there,</p>
<p>Thanks for subscribing to <strong>PulseFeed 🔥</strong> — your hub for programming, tech news, and curated learning resources.</p>
<p>You'll get our best links, feeds, and updates straight to your inbox. No spam, unsubscribe anytime.</p>
<p><a href="https://codeblaze-eng9.onrender.com/">See what's live →</a></p>
<p>— The PulseFeed Team</p>`
    });
    return { sent: true };
  } catch (e) {
    console.error('✉️  Subscribe email failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

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
let subscribers = load('subscribers', []);   // newsletter signups

// ---------- Advertise packages ($49–$999, category-wise) ----------
const AD_PACKAGES = [
  { id: 'text-link', category: 'Starter', name: 'Text Link Ad', price: 49, period: '/month', desc: 'A single sponsored text link in our sidebar link unit — the cheapest way to test us.', perks: ['Text only, one link', 'Sitewide sidebar', 'Great for a trial run'] },
  { id: 'sidebar', category: 'Display', name: 'Sidebar Banner', price: 100, period: '/month', desc: '300×250 banner on all article and Q&A pages.', perks: ['~500K impressions/mo', 'Link + image', 'Basic analytics'] },
  { id: 'newsletter', category: 'Newsletter', name: 'Newsletter Mention', price: 199, period: '/issue', desc: 'A featured blurb in our weekly dev newsletter.', perks: ['120K subscribers', '40% open rate', 'One link + 50 words'] },
  { id: 'qa-sponsor', category: 'Q&A', name: 'Sponsored Q&A Tag', price: 299, period: '/month', desc: 'Your brand pinned on a language tag page (e.g., #python).', perks: ['Tag-page takeover', 'Logo + tagline', 'Click tracking'] },
  { id: 'forum-pin', category: 'Forums', name: 'Pinned Forum Thread', price: 399, period: '/month', desc: 'A pinned, labeled sponsor thread in a forum category.', perks: ['Direct community access', 'AMA support', 'Moderation included'] },
  { id: 'news-slot', category: 'News', name: 'Tech News Sponsor Slot', price: 499, period: '/month', desc: 'Your card inside the live news feed (clearly labeled).', perks: ['Native placement', 'Rotates hourly', 'CTR reports'] },
  { id: 'home-banner', category: 'Display', name: 'Homepage Hero Banner', price: 599, period: '/month', desc: 'Premium 970×250 banner on the homepage.', perks: ['~2M impressions/mo', 'Top-of-fold', 'A/B creative rotation'] },
  { id: 'article', category: 'Content', name: 'Sponsored Article', price: 799, period: '/post', desc: 'A full technical article written with our editors.', perks: ['SEO-optimized', 'Permanent link', 'Social promotion'] },
  { id: 'takeover', category: 'Premium', name: 'Full Site Takeover', price: 999, period: '/week', desc: 'All banner slots + newsletter + pinned thread for one week.', perks: ['Every display slot', 'Newsletter feature', 'Pinned forum thread', 'Dedicated manager'] }
];

// ---------- Agentic Advertising Assistant ----------
// Structured "rules" for each package, derived from what each ad promises.
// The assistant reasons over these: it matches a campaign goal + budget to the
// best-fit packages, then enforces the placement rules when a booking is made.
//   unit         billing period the price applies to
//   monthlyEquiv price normalised to ~1 month, so mixed periods compare fairly
//   goals        objectives this placement is good at
//   reach        approx. eyeballs/impressions (0 = niche/not impression-based)
//   maxWords     hard copy limit (null = no limit)
//   maxLinks     links allowed in the creative/copy (null = n/a)
//   needs        creative assets the buyer must supply
//   requiresTag  true when a language/tag must be chosen (e.g. #python)
//   labelled     placement is shown labelled as sponsored
const AD_RULES = {
  'text-link': { unit: 'month', monthlyEquiv: 49, goals: ['awareness', 'traffic', 'retargeting'],                  reach: 500000,  maxWords: 10,  maxLinks: 1, needs: ['short link text (≤10 words)', 'click-through link'], requiresTag: false, labelled: false },
  sidebar:    { unit: 'month', monthlyEquiv: 100,  goals: ['awareness', 'traffic', 'retargeting'],                 reach: 500000,  maxWords: 20,  maxLinks: 1, needs: ['300×250 image', 'click-through link'], requiresTag: false, labelled: false },
  newsletter: { unit: 'issue', monthlyEquiv: 796,  goals: ['email', 'awareness', 'launch'],                        reach: 48000,   maxWords: 50,  maxLinks: 1, needs: ['≤50-word blurb', 'one link'],           requiresTag: false, labelled: true  },
  'qa-sponsor':{ unit: 'month', monthlyEquiv: 299, goals: ['targeting', 'niche', 'awareness'],                     reach: 0,       maxWords: 12,  maxLinks: 1, needs: ['logo', 'tagline'],                     requiresTag: true,  labelled: true  },
  'forum-pin':{ unit: 'month', monthlyEquiv: 399,  goals: ['community', 'engagement', 'feedback', 'launch'],       reach: 0,       maxWords: null, maxLinks: 2, needs: ['thread topic / opening post'],          requiresTag: false, labelled: true  },
  'news-slot':{ unit: 'month', monthlyEquiv: 499,  goals: ['awareness', 'traffic', 'launch'],                     reach: 0,       maxWords: 25,  maxLinks: 1, needs: ['native card headline + link'],          requiresTag: false, labelled: true  },
  'home-banner':{ unit:'month', monthlyEquiv: 599, goals: ['awareness', 'traffic', 'launch'],                     reach: 2000000, maxWords: 15,  maxLinks: 1, needs: ['970×250 image', 'click-through link'], requiresTag: false, labelled: false },
  article:    { unit: 'post',  monthlyEquiv: 799,  goals: ['content', 'seo', 'thought-leadership', 'education'],   reach: 0,       maxWords: null, maxLinks: 3, needs: ['article brief / topic'],                requiresTag: false, labelled: true  },
  takeover:   { unit: 'week',  monthlyEquiv: 999,  goals: ['launch', 'maximum', 'awareness', 'traffic'],          reach: 2500000, maxWords: null, maxLinks: 3, needs: ['all banner creatives', 'newsletter blurb'], requiresTag: false, labelled: true }
};

// Map free-text goal phrases the buyer might type onto canonical goal keys.
const GOAL_SYNONYMS = {
  awareness: ['awareness', 'brand', 'branding', 'visibility', 'impression', 'reach', 'exposure', 'eyeballs', 'recognition'],
  traffic: ['traffic', 'click', 'clicks', 'visit', 'signup', 'sign-up', 'sign ups', 'conversions', 'downloads', 'installs'],
  email: ['email', 'newsletter', 'subscriber', 'subscribers', 'inbox', 'mailing'],
  targeting: ['targeting', 'target', 'specific language', 'niche audience', 'developers who', 'audience of'],
  niche: ['niche', 'python', 'javascript', 'typescript', 'java', 'rust', 'golang', 'go ', 'c++', 'c#', 'php', 'swift', 'kotlin', 'sql', 'ruby'],
  community: ['community', 'engagement', 'engage', 'discussion', 'ama', 'feedback', 'conversation', 'talk to'],
  feedback: ['feedback', 'beta', 'survey', 'user research', 'testers'],
  content: ['content', 'article', 'blog', 'write-up', 'writeup', 'tutorial', 'guide', 'story', 'case study'],
  seo: ['seo', 'search', 'ranking', 'organic', 'evergreen', 'permanent'],
  'thought-leadership': ['thought leadership', 'authority', 'credibility', 'expertise', 'educate the market'],
  education: ['education', 'educate', 'teach', 'explain', 'developer education'],
  launch: ['launch', 'release', 'announce', 'announcement', 'go-to-market', 'gtm', 'big push', 'debut'],
  maximum: ['maximum', 'everything', 'all of it', 'dominate', 'takeover', 'take over', 'full', 'blitz', 'go big'],
  retargeting: ['retarget', 'retargeting', 'remind', 'stay top of mind']
};

const KNOWN_TAGS = ['python', 'javascript', 'typescript', 'java', 'c++', 'go', 'rust', 'c#', 'php', 'swift', 'kotlin', 'sql', 'ruby'];

// Turn a free-text campaign description into canonical goal keys.
function detectGoals(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const hits = [];
  for (const [goal, words] of Object.entries(GOAL_SYNONYMS)) {
    if (words.some(w => t.includes(w))) hits.push(goal);
  }
  return hits;
}

// Pull a language/tag out of free text, if present.
function detectTag(text) {
  const t = String(text || '').toLowerCase();
  return KNOWN_TAGS.find(tag => t.includes(tag)) || null;
}

// Parse a budget like "$500", "500/mo", "around 800 dollars", "1k".
function parseBudget(text) {
  const t = String(text || '').toLowerCase().replace(/,/g, '');
  const k = t.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const n = t.match(/\$?\s*(\d{2,6})/);
  return n ? parseInt(n[1], 10) : null;
}

const wordCount = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const linkCount = s => (String(s || '').match(/https?:\/\/[^\s]+/gi) || []).length;

// Score every package against the brief and return ranked recommendations.
function recommendPackages(brief) {
  const goals = (brief.goals && brief.goals.length ? brief.goals : detectGoals(brief.text)) || [];
  const budget = brief.budget != null ? brief.budget : parseBudget(brief.text);
  const tag = brief.tag || detectTag(brief.text);

  const scored = AD_PACKAGES.map(pkg => {
    const r = AD_RULES[pkg.id];
    let score = 0;
    const reasons = [];

    // 1) Goal fit — the biggest lever.
    const matched = goals.filter(g => r.goals.includes(g));
    if (matched.length) {
      score += 50 + (matched.length - 1) * 8;
      reasons.push(`Built for ${matched.join(' & ')} campaigns.`);
    }

    // 2) Budget fit (compare on a normalised monthly basis).
    if (budget != null) {
      if (r.monthlyEquiv <= budget) {
        score += 30; reasons.push(`Fits your ~$${budget} budget ($${pkg.price}${pkg.period}).`);
      } else if (r.monthlyEquiv <= budget * 1.25) {
        score += 8;  reasons.push(`Slight stretch on budget ($${pkg.price}${pkg.period}).`);
      } else {
        score -= 25; reasons.push(`Above your budget ($${pkg.price}${pkg.period}).`);
      }
    }

    // 3) Niche / tag targeting.
    if (tag && pkg.id === 'qa-sponsor') {
      score += 28; reasons.push(`Puts your brand on the #${tag} tag page — exactly your audience.`);
    }

    // 4) Reach bonus for awareness-led goals.
    if (goals.includes('awareness') && r.reach) {
      score += Math.min(15, Math.round(r.reach / 200000));
      reasons.push(`~${r.reach >= 1000000 ? (r.reach / 1000000) + 'M' : Math.round(r.reach / 1000) + 'K'} monthly reach.`);
    }

    return {
      id: pkg.id, name: pkg.name, category: pkg.category, price: pkg.price, period: pkg.period,
      desc: pkg.desc, perks: pkg.perks, score,
      fits: budget == null ? null : r.monthlyEquiv <= budget,
      reasons
    };
  }).sort((a, b) => b.score - a.score);

  return { goals, budget, tag, recommendations: scored };
}

// Enforce the placement's rules against the buyer's supplied copy/creative.
function validateBooking(pkg, campaign) {
  const r = AD_RULES[pkg.id];
  const copy = campaign.copy || '';
  const warnings = [];
  const notes = [];

  if (r.maxWords != null && copy) {
    const wc = wordCount(copy);
    if (wc > r.maxWords) warnings.push(`${pkg.name} allows ${r.maxWords} words; your copy is ${wc}. Please trim ${wc - r.maxWords}.`);
    else notes.push(`Copy length OK (${wc}/${r.maxWords} words).`);
  }
  if (r.maxLinks != null && copy) {
    const lc = linkCount(copy);
    if (lc > r.maxLinks) warnings.push(`${pkg.name} permits ${r.maxLinks} link${r.maxLinks === 1 ? '' : 's'}; found ${lc}.`);
  }
  if (r.requiresTag && !campaign.tag) warnings.push(`${pkg.name} runs on one language tag page — tell us which tag (e.g. #python).`);
  if (r.needs && r.needs.length) notes.push(`You'll need to supply: ${r.needs.join(', ')}.`);
  if (r.labelled) notes.push('This placement is shown clearly labelled as sponsored, per our disclosure policy.');

  return { ok: warnings.length === 0, warnings, notes };
}

// ---------- RSS news ----------
// Browser-like User-Agent so larger publishers (Medium, Business Insider,
// Gartner, etc.) don't reject the default feed request.
const parser = new Parser({
  timeout: 12000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PulseFeedBot/1.0; +https://codeblaze-eng9.onrender.com)' }
});
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
  { name: 'takeUforward', url: 'https://takeuforward.org/feed/' },
  { name: 'MakeUseOf', url: 'https://www.makeuseof.com/feed/' },
  { name: 'Medium', url: 'https://medium.com/feed/tag/programming' },
  { name: 'Business Insider', url: 'https://www.businessinsider.com/rss' },
  { name: 'Gartner', url: 'https://www.gartner.com/en/newsroom/rss' },
  // Electronics & Communication (ECE) industry channels
  { name: 'EE Times', url: 'https://www.eetimes.com/feed/' },
  { name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/rss/fulltext' },
  { name: 'EDN', url: 'https://www.edn.com/feed/' },
  { name: 'Semiconductor Engineering', url: 'https://semiengineering.com/feed/' }
];

// Top health & medical news sources (live RSS).
const HEALTH_FEEDS = [
  { name: 'ScienceDaily Health', url: 'https://www.sciencedaily.com/rss/health_medicine.xml' },
  { name: 'Medical Xpress', url: 'https://medicalxpress.com/rss-feed/' },
  { name: 'NPR Health', url: 'https://feeds.npr.org/1128/rss.xml' },
  { name: 'KFF Health News', url: 'https://kffhealthnews.org/feed/' },
  { name: 'STAT News', url: 'https://www.statnews.com/feed/' },
  { name: 'WHO', url: 'https://www.who.int/rss-feeds/news-english.xml' },
  { name: 'Healthline', url: 'https://www.healthline.com/rss/health-news' },
  { name: 'Mayo Clinic', url: 'https://newsnetwork.mayoclinic.org/feed/' },
  { name: 'MedlinePlus', url: 'https://medlineplus.gov/feeds/news_en.xml' },
  { name: 'NIH Director', url: 'https://directorsblog.nih.gov/feed/' }
];

// Top hospitality, hotel & travel-industry news sources (live RSS).
const HOSPITALITY_FEEDS = [
  { name: 'Skift', url: 'https://skift.com/feed/' },
  { name: 'PhocusWire', url: 'https://www.phocuswire.com/rss' },
  { name: 'Lodging Magazine', url: 'https://lodgingmagazine.com/feed/' },
  { name: 'eHotelier', url: 'https://insights.ehotelier.com/feed/' },
  { name: 'Hospitality Net', url: 'https://www.hospitalitynet.org/rss/global.xml' },
  { name: 'Hotel Management', url: 'https://www.hotelmanagement.net/rss.xml' },
  { name: 'The Points Guy', url: 'https://thepointsguy.com/feed/' },
  { name: 'Travel + Leisure', url: 'https://www.travelandleisure.com/feeds/all.rss' }
];

// Public transport, transit & mobility news (live RSS).
const TRANSPORT_FEEDS = [
  { name: 'Intelligent Transport', url: 'https://www.intelligenttransport.com/feed/' },
  { name: 'Railway Technology', url: 'https://www.railway-technology.com/feed/' },
  { name: 'Global Railway Review', url: 'https://www.globalrailwayreview.com/feed/' },
  { name: 'Railway Gazette', url: 'https://www.railwaygazette.com/rss' },
  { name: 'Streetsblog USA', url: 'https://usa.streetsblog.org/feed/' },
  { name: 'Mass Transit', url: 'https://www.masstransitmag.com/rss' },
  { name: 'Metro Rail News', url: 'https://www.metrorailnews.in/feed/' },
  { name: 'Smart Cities Dive', url: 'https://www.smartcitiesdive.com/feeds/news/' }
];

// Courier, parcel & logistics news (live RSS).
const COURIER_FEEDS = [
  { name: 'Post & Parcel', url: 'https://postandparcel.info/feed/' },
  { name: 'Parcel & Postal Tech Intl', url: 'https://www.parcelandpostaltechnologyinternational.com/feed' },
  { name: 'The Loadstar', url: 'https://theloadstar.com/feed/' },
  { name: 'Logistics Manager', url: 'https://www.logisticsmanager.com/feed/' },
  { name: 'Supply Chain Dive', url: 'https://www.supplychaindive.com/feeds/news/' },
  { name: 'FreightWaves', url: 'https://www.freightwaves.com/feed' },
  { name: 'Air Cargo News', url: 'https://www.aircargonews.net/feed/' },
  { name: 'Parcel Industry', url: 'https://parcelindustry.com/rss.xml' }
];

// Weather & climate news (live RSS).
const WEATHER_FEEDS = [
  { name: 'NOAA News', url: 'https://www.noaa.gov/news-releases.xml' },
  { name: 'NWS Bulletins', url: 'https://www.weather.gov/rss_page.php?site_name=nws' },
  { name: 'Met Office', url: 'https://weather.metoffice.gov.uk/feeds/rss' },
  { name: 'Severe Weather Europe', url: 'https://www.severe-weather.eu/feed/' },
  { name: 'Watts Up With That', url: 'https://wattsupwiththat.com/feed/' },
  { name: 'Yale Climate Connections', url: 'https://yaleclimateconnections.org/feed/' },
  { name: 'Carbon Brief', url: 'https://www.carbonbrief.org/feed/' },
  { name: 'The Watchers', url: 'https://watchers.news/feed/' }
];

// Ethics, integrity & responsible-tech news (live RSS).
const ETHICS_FEEDS = [
  { name: 'Ethics Unwrapped', url: 'https://ethicsunwrapped.utexas.edu/feed' },
  { name: 'Markkula Center', url: 'https://www.scu.edu/ethics/all-about-ethics/rss/' },
  { name: 'The Ethics Centre', url: 'https://ethics.org.au/feed/' },
  { name: 'AlgorithmWatch', url: 'https://algorithmwatch.org/en/feed/' },
  { name: 'Montreal AI Ethics', url: 'https://montrealethics.ai/feed/' },
  { name: 'FCPA Blog', url: 'https://fcpablog.com/feed/' },
  { name: 'Transparency Intl', url: 'https://www.transparency.org/en/rss' },
  { name: 'MIT Tech Review Ethics', url: 'https://www.technologyreview.com/topic/policy/feed' }
];

// Emergency services, disaster response & public-safety news (live RSS).
const EMERGENCY_FEEDS = [
  { name: 'ReliefWeb', url: 'https://reliefweb.int/updates/rss.xml' },
  { name: 'GDACS Alerts', url: 'https://www.gdacs.org/xml/rss.xml' },
  { name: 'EMS1', url: 'https://www.ems1.com/rss/' },
  { name: 'FireRescue1', url: 'https://www.firerescue1.com/rss/' },
  { name: 'Fire Engineering', url: 'https://www.fireengineering.com/feed/' },
  { name: 'JEMS', url: 'https://www.jems.com/feed/' },
  { name: 'Homeland Security Today', url: 'https://www.hstoday.us/feed/' },
  { name: 'ReliefWeb Disasters', url: 'https://reliefweb.int/disasters/rss.xml' }
];

// Trending across the dev community — what's hot right now (live RSS).
const TRENDING_FEEDS = [
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { name: 'HN Best', url: 'https://hnrss.org/best' },
  { name: 'Lobsters', url: 'https://lobste.rs/rss' },
  { name: 'Dev.to', url: 'https://dev.to/feed' },
  { name: 'GitHub Trending', url: 'https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml' },
  { name: 'Product Hunt', url: 'https://www.producthunt.com/feed' },
  { name: 'Reddit r/programming', url: 'https://www.reddit.com/r/programming/top/.rss?t=day' },
  { name: 'Hackaday', url: 'https://hackaday.com/blog/feed/' }
];

const NEWS_TTL = 10 * 60 * 1000; // 10 minutes
let newsCache = { items: [], fetchedAt: 0 };
let healthCache = { items: [], fetchedAt: 0 };
let hospitalityCache = { items: [], fetchedAt: 0 };
let transportCache = { items: [], fetchedAt: 0 };
let courierCache = { items: [], fetchedAt: 0 };
let weatherCache = { items: [], fetchedAt: 0 };
let ethicsCache = { items: [], fetchedAt: 0 };
let emergencyCache = { items: [], fetchedAt: 0 };
let trendingCache = { items: [], fetchedAt: 0 };

// Aggregate any list of feeds into a single, date-sorted item list.
async function fetchFeeds(feeds) {
  const results = await Promise.allSettled(feeds.map(async f => {
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
  const failed = results.map((r, i) => r.status === 'rejected' ? feeds[i].name : null).filter(Boolean);
  return { items, failed };
}

// Serve a cached feed endpoint for a given feed list + cache slot.
function feedEndpoint(feeds, getCache, setCache) {
  return async (req, res) => {
    try {
      const cache = getCache();
      if (Date.now() - cache.fetchedAt > NEWS_TTL || !cache.items.length) {
        const { items, failed } = await fetchFeeds(feeds);
        setCache({ items: items.length ? items : cache.items, fetchedAt: Date.now(), failed });
      }
      const c = getCache();
      res.json({ items: c.items, fetchedAt: c.fetchedAt, failedFeeds: c.failed || [] });
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch feeds', detail: e.message });
    }
  };
}

app.get('/api/news', feedEndpoint(FEEDS, () => newsCache, c => { newsCache = c; }));
app.get('/api/health-news', feedEndpoint(HEALTH_FEEDS, () => healthCache, c => { healthCache = c; }));
app.get('/api/hospitality-news', feedEndpoint(HOSPITALITY_FEEDS, () => hospitalityCache, c => { hospitalityCache = c; }));
app.get('/api/transport-news', feedEndpoint(TRANSPORT_FEEDS, () => transportCache, c => { transportCache = c; }));
app.get('/api/courier-news', feedEndpoint(COURIER_FEEDS, () => courierCache, c => { courierCache = c; }));
app.get('/api/weather-news', feedEndpoint(WEATHER_FEEDS, () => weatherCache, c => { weatherCache = c; }));
app.get('/api/ethics-news', feedEndpoint(ETHICS_FEEDS, () => ethicsCache, c => { ethicsCache = c; }));
app.get('/api/emergency-news', feedEndpoint(EMERGENCY_FEEDS, () => emergencyCache, c => { emergencyCache = c; }));
app.get('/api/trending-news', feedEndpoint(TRENDING_FEEDS, () => trendingCache, c => { trendingCache = c; }));

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

// ---------- Stack Exchange network (Stack Overflow + sibling Q&A sites) ----------
const SO_API = 'https://api.stackexchange.com/2.3';
let soCache = {}; // key -> { data, fetchedAt }
const SO_TTL = 10 * 60 * 1000;

// Whitelisted Stack Exchange sites relevant to developers. Same API + shape for all.
const SE_SITES = {
  stackoverflow: 'Stack Overflow',
  superuser: 'Super User',
  serverfault: 'Server Fault',
  askubuntu: 'Ask Ubuntu',
  softwareengineering: 'Software Engineering',
  codereview: 'Code Review',
  unix: 'Unix & Linux',
  devops: 'DevOps',
  security: 'Information Security',
  dba: 'Database Administrators'
};

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

// List the available Stack Exchange sites (for the Q&A tab picker).
app.get('/api/so/sites', (req, res) => {
  res.json(Object.entries(SE_SITES).map(([id, name]) => ({ id, name })));
});

app.get('/api/so', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const tag = String(req.query.tag || '').trim().slice(0, 40);
  // Validate the requested site against the whitelist; default to Stack Overflow.
  let site = String(req.query.site || 'stackoverflow').trim().toLowerCase();
  if (!SE_SITES[site]) site = 'stackoverflow';
  const key = `site=${site}|q=${q}|tag=${tag}`;
  try {
    const cached = soCache[key];
    if (cached && Date.now() - cached.fetchedAt < SO_TTL) return res.json(cached.data);

    let url;
    if (q) {
      url = `${SO_API}/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=${site}&pagesize=20&filter=default`;
    } else if (tag) {
      url = `${SO_API}/questions?order=desc&sort=hot&tagged=${encodeURIComponent(tag)}&site=${site}&pagesize=20`;
    } else {
      url = `${SO_API}/questions?order=desc&sort=hot&site=${site}&pagesize=20`;
    }
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`Stack Exchange API returned ${r.status}`);
    const body = await r.json();
    const data = {
      site, siteName: SE_SITES[site],
      items: (body.items || []).map(mapSoQuestion),
      quotaRemaining: body.quota_remaining
    };
    soCache[key] = { data, fetchedAt: Date.now() };
    if (Object.keys(soCache).length > 80) soCache = { [key]: soCache[key] }; // crude cap
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `Failed to reach ${SE_SITES[site] || 'Stack Exchange'}`, detail: e.message });
  }
});

// ---------- Advertise ----------
app.get('/api/ads/packages', (req, res) => res.json(AD_PACKAGES));

// Agentic assistant: recommend packages from a campaign brief.
// Body: { text?, goals?, budget?, tag? } — any subset; free text is parsed.
app.post('/api/ads/assistant/recommend', (req, res) => {
  const { text, goals, budget, tag } = req.body || {};
  const brief = {
    text: String(text || '').slice(0, 1000),
    goals: Array.isArray(goals) ? goals : undefined,
    budget: budget != null && budget !== '' ? Number(budget) : undefined,
    tag: tag ? String(tag).toLowerCase() : undefined
  };
  const result = recommendPackages(brief);
  const top = result.recommendations.filter(r => r.score > 0).slice(0, 3);
  res.json({
    goals: result.goals,
    budget: result.budget,
    tag: result.tag,
    top,
    all: result.recommendations
  });
});

// Agentic assistant: validate a draft against a package's rules before booking.
// Body: { packageId, copy?, tag? }
app.post('/api/ads/assistant/validate', (req, res) => {
  const { packageId, copy, tag } = req.body || {};
  const pkg = AD_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: 'invalid packageId' });
  res.json({ package: pkg.name, ...validateBooking(pkg, { copy, tag }) });
});

app.post('/api/ads/inquiries', async (req, res) => {
  const { packageId, company, email, message, goal, budget, copy, tag, duration } = req.body || {};
  const pkg = AD_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: 'invalid packageId' });
  if (!company || !email) return res.status(400).json({ error: 'company and email are required' });

  // Run the placement rules over whatever creative/copy the buyer gave us.
  const validation = validateBooking(pkg, { copy: copy || message, tag });

  const inquiry = {
    id: uid(), packageId, package: pkg.name, price: pkg.price, period: pkg.period,
    company: String(company).slice(0, 100), email: String(email).slice(0, 100),
    message: String(message || '').slice(0, 2000),
    // Campaign details captured by the assistant (all optional).
    goal: goal ? String(goal).slice(0, 120) : undefined,
    budget: budget != null && budget !== '' ? Number(budget) : undefined,
    tag: tag ? String(tag).toLowerCase().slice(0, 40) : undefined,
    duration: duration ? String(duration).slice(0, 60) : undefined,
    copy: copy ? String(copy).slice(0, 2000) : undefined,
    link: extractLink(copy || message),
    status: 'pending_payment',      // becomes 'active' once payment is received
    activatedAt: null,
    validation,
    createdAt: new Date().toISOString()
  };
  adInquiries.push(inquiry);
  save('ad_inquiries', adInquiries);

  // Fire off owner alert + customer confirmation (never blocks the booking).
  const emailResult = await sendBookingEmails(inquiry, pkg);

  const emailLine = emailResult.sent
    ? ` A confirmation has been emailed to ${inquiry.email}.`
    : ' Our team will confirm by email.';
  res.status(201).json({
    ok: true,
    id: inquiry.id,
    booked: !validation.warnings.length,
    warnings: validation.warnings,
    notes: validation.notes,
    emailed: emailResult.sent,
    note: `Thanks ${inquiry.company}! Your ${pkg.name} ($${pkg.price}${pkg.period}) request is in${validation.warnings.length ? ' — we flagged a couple of things below' : ''}.${emailLine}`
  });
});

// ---------- Ad lifecycle: payment & activation ----------
// A booking is created as 'pending_payment'. It goes live ('active') either via
// the demo "Pay now" button (simulated — no real charge) or when the owner marks
// it paid from the key-protected /admin page. Active ads render on the site.
const ADMIN_KEY = process.env.ADMIN_KEY || 'blaze-admin';
const adminOk = req => (req.query.key || (req.body && req.body.key)) === ADMIN_KEY;
function extractLink(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"')]+/i);
  return m ? m[0] : null;
}
// Shape an inquiry for public rendering (never expose the buyer's email).
function publicAd(i) {
  return {
    id: i.id, packageId: i.packageId, package: i.package,
    company: i.company, tag: i.tag || null,
    body: i.copy || i.message || '', link: i.link || null,
    price: i.price, period: i.period
  };
}

// Active (paid) ads for the site to render.
app.get('/api/ads/active', (req, res) => {
  res.json(adInquiries.filter(i => i.status === 'active').map(publicAd));
});

// Demo "Pay now" — simulated payment, no real money changes hands.
app.post('/api/ads/inquiries/:id/pay', (req, res) => {
  const inq = adInquiries.find(i => i.id === req.params.id);
  if (!inq) return res.status(404).json({ error: 'booking not found' });
  if (inq.status !== 'active') {
    inq.status = 'active'; inq.paidVia = 'demo'; inq.activatedAt = new Date().toISOString();
    save('ad_inquiries', adInquiries);
  }
  res.json({ ok: true, id: inq.id, status: inq.status, ad: publicAd(inq) });
});

// Owner admin: list every booking.
app.get('/api/ads/admin/list', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'invalid admin key' });
  res.json(adInquiries.map(i => ({
    id: i.id, packageId: i.packageId, package: i.package, price: i.price, period: i.period,
    company: i.company, email: i.email, status: i.status || 'pending_payment',
    tag: i.tag || null, body: i.copy || i.message || '', link: i.link || null,
    paidVia: i.paidVia || null, createdAt: i.createdAt, activatedAt: i.activatedAt || null
  })));
});

// Owner admin: set a booking's status (payment received / hold / reject).
app.post('/api/ads/admin/set-status', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'invalid admin key' });
  const { id, status } = req.body || {};
  const inq = adInquiries.find(i => i.id === id);
  if (!inq) return res.status(404).json({ error: 'booking not found' });
  if (!['pending_payment', 'active', 'rejected'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  inq.status = status;
  inq.activatedAt = status === 'active' ? new Date().toISOString() : null;
  if (status === 'active' && !inq.paidVia) inq.paidVia = 'owner';
  save('ad_inquiries', adInquiries);
  res.json({ ok: true, id, status });
});

// ---------- Newsletter subscribe ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post('/api/subscribe', async (req, res) => {
  const raw = (req.body && req.body.email) || '';
  const email = String(raw).trim().toLowerCase().slice(0, 120);
  const source = req.body && req.body.source ? String(req.body.source).slice(0, 40) : 'site';
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  const existing = subscribers.find(s => s.email === email);
  if (existing) {
    return res.json({ ok: true, already: true, note: "You're already on the list — thanks for the love! 🔥" });
  }
  const sub = { id: uid(), email, source, createdAt: new Date().toISOString() };
  subscribers.push(sub);
  save('subscribers', subscribers);
  const emailResult = await sendSubscribeEmails(sub);
  res.status(201).json({
    ok: true,
    emailed: emailResult.sent,
    note: emailResult.sent
      ? "You're in! A welcome email is on its way. 🔥"
      : "You're in! Welcome to PulseFeed. 🔥"
  });
});

// Owner admin: list subscribers (key-protected).
app.get('/api/subscribers/admin/list', (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'invalid admin key' });
  res.json({ count: subscribers.length, subscribers });
});

// Owner admin page (key-protected in the browser via ?key=...).
const ADMIN_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PulseFeed — Ad Admin</title>
<style>
  :root{--gold:#b07d10;--ink:#2a1e04;}
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',system-ui,sans-serif;margin:0;background:#f7f4fb;color:#241a33;padding:24px}
  h1{margin:0 0 4px;font-size:1.4rem}.sub{color:#6f6790;margin:0 0 18px;font-size:.9rem}
  .keybar{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
  .keybar input{padding:9px 12px;border:1px solid #d9d2ea;border-radius:8px;min-width:220px}
  .keybar button{padding:9px 16px;border:none;border-radius:8px;background:#5200FF;color:#fff;font-weight:700;cursor:pointer}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(90,64,0,.08)}
  th,td{text-align:left;padding:11px 13px;border-bottom:1px solid #eee;font-size:.88rem;vertical-align:top}
  th{background:#faf7ff;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:#6f6790}
  .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:700}
  .s-active{background:#e5f7ec;color:#1a7d43}.s-pending_payment{background:#fff3cf;color:#7a5606}.s-rejected{background:#fde8e8;color:#b23}
  .acts button{margin:2px 3px 0 0;padding:6px 10px;border:1px solid #d9d2ea;border-radius:7px;background:#fff;cursor:pointer;font-size:.78rem;font-weight:600}
  .acts .go{border-color:#1a7d43;color:#1a7d43}.acts .hold{border-color:#7a5606;color:#7a5606}.acts .rej{border-color:#b23;color:#b23}
  .msg{margin:10px 0;color:#6f6790;font-size:.9rem}
  code{background:#f0ebfb;padding:1px 5px;border-radius:4px}
</style></head><body>
<h1>🔥 Ad Bookings — Admin</h1>
<p class="sub">Mark a booking <b>Paid</b> once you've received payment; it goes live on the site immediately.</p>
<div class="keybar">
  <input id="key" type="password" placeholder="Admin key" />
  <button onclick="load()">Load bookings</button>
</div>
<div class="msg" id="msg">Enter your admin key and load bookings.</div>
<table id="tbl" style="display:none"><thead><tr>
  <th>Company</th><th>Package</th><th>Status</th><th>Creative</th><th>Booked</th><th>Actions</th>
</tr></thead><tbody id="rows"></tbody></table>
<script>
  const qp = new URLSearchParams(location.search);
  if (qp.get('key')) document.getElementById('key').value = qp.get('key');
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function load(){
    const key = document.getElementById('key').value.trim();
    const msg = document.getElementById('msg');
    if(!key){ msg.textContent='Enter your admin key.'; return; }
    msg.textContent='Loading…';
    try{
      const r = await fetch('/api/ads/admin/list?key='+encodeURIComponent(key));
      if(!r.ok){ msg.textContent = r.status===401 ? 'Invalid admin key.' : 'Error '+r.status; return; }
      const list = await r.json();
      window._key = key;
      const rows = document.getElementById('rows');
      if(!list.length){ msg.textContent='No bookings yet.'; document.getElementById('tbl').style.display='none'; return; }
      msg.textContent = list.length+' booking(s).';
      document.getElementById('tbl').style.display='';
      rows.innerHTML = list.slice().reverse().map(function(i){
        const link = i.link ? '<br><a href="'+esc(i.link)+'" target="_blank" rel="noopener">'+esc(i.link)+'</a>' : '';
        return '<tr>'
          +'<td><b>'+esc(i.company)+'</b><br><span style="color:#6f6790">'+esc(i.email)+'</span></td>'
          +'<td>'+esc(i.package)+'<br><span style="color:#6f6790">$'+i.price+esc(i.period)+'</span></td>'
          +'<td><span class="badge s-'+esc(i.status)+'">'+esc(i.status.replace('_',' '))+'</span></td>'
          +'<td style="max-width:280px">'+esc(i.body||'—')+link+'</td>'
          +'<td style="color:#6f6790">'+esc(new Date(i.createdAt).toLocaleString())+'</td>'
          +'<td class="acts">'
            +'<button class="go" onclick="setStatus(\\''+i.id+'\\',\\'active\\')">Mark Paid ✓</button>'
            +'<button class="hold" onclick="setStatus(\\''+i.id+'\\',\\'pending_payment\\')">Pending</button>'
            +'<button class="rej" onclick="setStatus(\\''+i.id+'\\',\\'rejected\\')">Reject</button>'
          +'</td></tr>';
      }).join('');
    }catch(e){ msg.textContent='Failed: '+e.message; }
  }
  async function setStatus(id,status){
    const r = await fetch('/api/ads/admin/set-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,status:status,key:window._key})});
    if(r.ok){ load(); } else { alert('Failed ('+r.status+')'); }
  }
  if (qp.get('key')) load();
</script></body></html>`;
app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(ADMIN_PAGE);
});

// ---------- Languages knowledge ----------
app.get('/api/languages', (req, res) => {
  res.json(load('languages', []));
});

// ---------- Total visitors ----------
// Simple persisted counter. GET reads the total; POST increments it (the
// frontend counts each browser once via a localStorage flag).
// Note: on hosts with an ephemeral filesystem (e.g. Render free tier) this
// resets on redeploy — swap in a database for a durable count.
let visits = load('visits', { count: 0 });
app.get('/api/visits', (req, res) => res.json({ count: visits.count }));
app.post('/api/visits', (req, res) => {
  visits.count += 1;
  save('visits', visits);
  res.json({ count: visits.count });
});

// ---------- htmx HTML-fragment partials ----------
// These return HTML (not JSON) so htmx can swap them straight into the page.
const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const codeH = s => escH(s).replace(/`([^`]+)`/g, '<code>$1</code>');
function ago(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
const sendHtml = (res, s) => res.type('html').send(s);
const withReplies = t => threads.map(({ posts, ...rest }) => ({ ...rest, replies: Math.max(0, posts.length - 1) }));

function questionsHTML(list) {
  return list.map(x => `
    <div class="card q-item" id="q-${x.id}">
      <h3><span class="votes">▲ ${x.votes}</span>${escH(x.title)}</h3>
      <p class="muted">${escH(x.body)}</p>
      <div class="meta">
        ${x.tags.map(t => `<span class="tag">${escH(t)}</span>`).join('')}
        <span>by ${escH(x.author)} · ${ago(x.createdAt)} · ${x.answers.length} answer${x.answers.length === 1 ? '' : 's'}</span>
        <button class="btn btn-ghost btn-sm" hx-post="/partials/questions/${x.id}/vote" hx-target="#qa-list" hx-swap="innerHTML">▲ Upvote</button>
      </div>
      ${x.answers.map(a => `
        <div class="answer ${a.accepted ? 'accepted' : ''}">
          ${a.accepted ? '<span class="accepted-badge">✓ ACCEPTED</span> ' : ''}${codeH(a.body)}
          <div class="meta"><span>▲ ${a.votes} · ${escH(a.author)} · ${ago(a.createdAt)}</span></div>
        </div>`).join('')}
      <form hx-post="/partials/questions/${x.id}/answers" hx-target="#qa-list" hx-swap="innerHTML" hx-on::after-request="this.reset()" style="margin-top:12px; display:flex; gap:8px">
        <input class="input" style="margin:0" name="body" placeholder="Write an answer…" required />
        <button class="btn btn-primary btn-sm" type="submit">Answer</button>
      </form>
    </div>`).join('') || '<p class="muted">No questions match. Ask the first one!</p>';
}

function forumListHTML(list) {
  return list.map(t => `
    <div class="card clickable q-item" hx-get="/partials/forums/${t.id}" hx-target="#thread-view" hx-swap="innerHTML"
         hx-on::after-request="document.getElementById('forum-list').classList.add('hidden');document.getElementById('thread-view').classList.remove('hidden')">
      <h3>${escH(t.title)}</h3>
      <div class="meta"><span class="tag">${escH(t.category)}</span><span>by ${escH(t.author)} · ${ago(t.createdAt)} · 💬 ${t.replies} replies · 👁 ${t.views} views</span></div>
    </div>`).join('') || '<p class="muted">No threads yet in this category.</p>';
}

function threadHTML(t) {
  return `
    <button class="btn btn-ghost btn-sm" hx-get="/partials/forums" hx-target="#forum-list" hx-swap="innerHTML"
            hx-on::after-request="document.getElementById('thread-view').classList.add('hidden');document.getElementById('forum-list').classList.remove('hidden')">← Back to forums</button>
    <div class="card" style="margin-top:12px">
      <h2>${escH(t.title)}</h2>
      <div class="meta"><span class="tag">${escH(t.category)}</span><span>👁 ${t.views} views</span></div>
      ${t.posts.map(p => `<div class="answer">${escH(p.body)}<div class="meta"><span>${escH(p.author)} · ${ago(p.createdAt)}</span></div></div>`).join('')}
      <form hx-post="/partials/forums/${t.id}/posts" hx-target="#thread-view" hx-swap="innerHTML" hx-on::after-request="this.reset()" style="margin-top:14px; display:flex; gap:8px">
        <input class="input" style="margin:0" name="body" placeholder="Write a reply…" required />
        <button class="btn btn-primary btn-sm" type="submit">Reply</button>
      </form>
    </div>`;
}

// Q&A
app.get('/partials/questions', (req, res) => {
  const { q } = req.query;
  let list = questions;
  if (q) list = list.filter(x => (x.title + x.body).toLowerCase().includes(String(q).toLowerCase()));
  sendHtml(res, questionsHTML(list));
});
app.post('/partials/questions', (req, res) => {
  const { title, body, tags, author } = req.body || {};
  if (title && body) {
    questions.unshift({
      id: uid(), title: String(title).slice(0, 200), body: String(body).slice(0, 5000),
      tags: (Array.isArray(tags) ? tags : String(tags || '').split(',')).map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 5),
      author: String(author || 'anonymous').slice(0, 40), votes: 0, answers: [], createdAt: new Date().toISOString()
    });
    save('questions', questions);
  }
  sendHtml(res, questionsHTML(questions));
});
app.post('/partials/questions/:id/answers', (req, res) => {
  const qn = questions.find(x => x.id === req.params.id);
  const { body, author } = req.body || {};
  if (qn && body) {
    qn.answers.push({ id: uid(), body: String(body).slice(0, 5000), author: String(author || 'you').slice(0, 40), votes: 0, accepted: false, createdAt: new Date().toISOString() });
    save('questions', questions);
  }
  sendHtml(res, questionsHTML(questions));
});
app.post('/partials/questions/:id/vote', (req, res) => {
  const qn = questions.find(x => x.id === req.params.id);
  if (qn) { qn.votes += 1; save('questions', questions); }
  sendHtml(res, questionsHTML(questions));
});

// Forums
app.get('/partials/forums', (req, res) => {
  const { category } = req.query;
  let list = withReplies();
  if (category) list = list.filter(t => t.category.toLowerCase() === String(category).toLowerCase());
  sendHtml(res, forumListHTML(list));
});
app.get('/partials/forums/:id', (req, res) => {
  const t = threads.find(x => x.id === req.params.id);
  if (!t) return sendHtml(res, '<p class="muted">Thread not found.</p>');
  t.views++; save('threads', threads);
  sendHtml(res, threadHTML(t));
});
app.post('/partials/forums', (req, res) => {
  const { title, body, category, author } = req.body || {};
  if (title && body) {
    threads.unshift({
      id: uid(), title: String(title).slice(0, 200), category: String(category || 'General').slice(0, 40),
      author: String(author || 'anonymous').slice(0, 40), createdAt: new Date().toISOString(), views: 0,
      posts: [{ id: uid(), body: String(body).slice(0, 5000), author: String(author || 'anonymous').slice(0, 40), createdAt: new Date().toISOString() }]
    });
    save('threads', threads);
  }
  sendHtml(res, forumListHTML(withReplies()));
});
app.post('/partials/forums/:id/posts', (req, res) => {
  const t = threads.find(x => x.id === req.params.id);
  if (!t) return sendHtml(res, '<p class="muted">Thread not found.</p>');
  const { body, author } = req.body || {};
  if (body) {
    t.posts.push({ id: uid(), body: String(body).slice(0, 5000), author: String(author || 'you').slice(0, 40), createdAt: new Date().toISOString() });
    save('threads', threads);
  }
  sendHtml(res, threadHTML(t));
});

// Advertise inquiry (htmx manual booking form)
app.post('/partials/ads/inquiries', async (req, res) => {
  const { packageId, company, email, message } = req.body || {};
  const pkg = AD_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return sendHtml(res, '<span class="assistant-warn">Please pick a package first.</span>');
  if (!company || !email) return sendHtml(res, '<span class="assistant-warn">Company and work email are required.</span>');
  const validation = validateBooking(pkg, { copy: message });
  const inquiry = {
    id: uid(), packageId, package: pkg.name, price: pkg.price, period: pkg.period,
    company: String(company).slice(0, 100), email: String(email).slice(0, 100),
    message: String(message || '').slice(0, 2000), copy: message ? String(message).slice(0, 2000) : undefined,
    link: extractLink(message), status: 'pending_payment', activatedAt: null,
    validation, createdAt: new Date().toISOString()
  };
  adInquiries.push(inquiry); save('ad_inquiries', adInquiries);
  const emailResult = await sendBookingEmails(inquiry, pkg);
  let out = `✅ Thanks ${escH(company)}! Your ${escH(pkg.name)} ($${pkg.price}${pkg.period}) request is in.` +
    (emailResult.sent ? ` A confirmation was emailed to ${escH(email)}.` : ' Our team will confirm by email.');
  if (validation.warnings.length) out += `<br><span class="assistant-warn">Please review:</span><ul>${validation.warnings.map(w => `<li>${escH(w)}</li>`).join('')}</ul>`;
  sendHtml(res, out);
});

// SEO: robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\n');
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🔥 PulseFeed running at http://localhost:${PORT}`));
