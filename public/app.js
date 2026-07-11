// CodeBlaze frontend
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeAgo = d => {
  if (!d) return '';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s/60)) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
};
const api = async (url, opts) => {
  const r = await fetch(url, opts ? { headers: {'Content-Type':'application/json'}, ...opts } : undefined);
  if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || r.statusText);
  return r.json();
};

// ---------- Theme (dark / light) ----------
(function initTheme() {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  const apply = t => {
    root.setAttribute('data-theme', t);
    if (btn) btn.setAttribute('aria-pressed', String(t === 'light'));
  };
  // The inline <head> script already picked the initial theme; sync button state.
  apply(root.getAttribute('data-theme') || 'dark');
  if (btn) btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem('cbf-theme', next); } catch (e) {}
  });
  // Follow the OS theme only while the user hasn't chosen one explicitly.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
      let saved = null;
      try { saved = localStorage.getItem('cbf-theme'); } catch (_) {}
      if (!saved) apply(e.matches ? 'light' : 'dark');
    });
  }
})();

// ---------- Navigation ----------
function nav(view) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  window.scrollTo({ top: 0 });
  if (view === 'news' && !state.newsLoaded) loadNews();
  if (view === 'health' && !state.healthLoaded) loadHealth();
  if (view === 'hospitality' && !state.hospitalityLoaded) loadHospitality();
  if (view === 'advertise' && typeof aaStart === 'function' && !AA.started) aaStart();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-nav]');
  if (t) { e.preventDefault(); nav(t.dataset.nav); closeMobileNav(); }
});

// ---------- Mobile nav (hamburger) ----------
function closeMobileNav() {
  const nv = document.getElementById('site-nav');
  const tg = document.getElementById('nav-toggle');
  if (nv) nv.classList.remove('open');
  if (tg) tg.setAttribute('aria-expanded', 'false');
}
(function initMobileNav() {
  const tg = document.getElementById('nav-toggle');
  const nv = document.getElementById('site-nav');
  if (!tg || !nv) return;
  tg.addEventListener('click', () => {
    const open = nv.classList.toggle('open');
    tg.setAttribute('aria-expanded', String(open));
  });
  // Close when tapping outside the header.
  document.addEventListener('click', e => {
    if (nv.classList.contains('open') && !e.target.closest('.topbar')) closeMobileNav();
  });
})();

const state = { languages: [], questions: [], news: [], newsLoaded: false, newsFilter: '', newsCategory: '', health: [], healthLoaded: false, healthFilter: '', healthCategory: '', hospitality: [], hospitalityLoaded: false, hospitalityFilter: '', adPkg: null };

// ---------- Languages ----------
async function loadLanguages() {
  state.languages = await api('/api/languages');
  $('#stat-langs').textContent = state.languages.length;
  $('#lang-grid').innerHTML = state.languages.map((l, i) => `
    <div class="card clickable" onclick="showLang(${i})">
      <h3>${l.icon} ${esc(l.name)}</h3>
      <p class="muted">${esc(l.tagline)}</p>
      <div class="meta">${l.usedFor.slice(0,3).map(u => `<span class="tag">${esc(u)}</span>`).join('')}</div>
    </div>`).join('');
}
window.showLang = i => {
  const l = state.languages[i];
  const d = $('#lang-detail');
  d.classList.remove('hidden');
  d.innerHTML = `
    <div class="card">
      <h2>${l.icon} ${esc(l.name)}</h2>
      <p class="muted">${esc(l.tagline)}</p>
      <p style="margin-top:12px"><b>Used for:</b> ${l.usedFor.map(esc).join(' · ')}</p>
      <h3 style="margin-top:18px">💡 Tips &amp; Tricks</h3>
      <ul>${l.tips.map(t => `<li>${esc(t).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>`).join('')}</ul>
      <h3>Signature snippet</h3>
      <pre>${esc(l.snippet)}</pre>
    </div>`;
  d.scrollIntoView({ behavior: 'smooth' });
};

// ---------- Q&A + Forums (htmx-driven) ----------
// Lists and write actions render server-side and are swapped in by htmx
// (hx-* attributes in index.html). JS here only coordinates the tabs, the
// search box, and toggling the "create" forms.

// Home page needs question/thread counts + trending; the lists come from htmx.
async function loadStats() {
  try {
    const [qs, ths] = await Promise.all([api('/api/questions'), api('/api/forums')]);
    state.questions = qs;
    $('#stat-questions').textContent = qs.length;
    $('#stat-threads').textContent = ths.length;
  } catch (e) {}
}
$('#btn-ask').onclick = () => $('#qa-form').classList.toggle('hidden');
let qaTimer;
$('#qa-search').oninput = e => {
  clearTimeout(qaTimer);
  const v = e.target.value;
  qaTimer = setTimeout(() => {
    if (state.qaTab === 'so') loadSO(v);
    else htmx.ajax('GET', '/partials/questions' + (v ? '?q=' + encodeURIComponent(v) : ''), { target: '#qa-list', swap: 'innerHTML' });
  }, 400);
};

// ---------- Stack Exchange tab (Stack Overflow + sibling Q&A sites) ----------
state.qaTab = 'community';
state.soLoaded = false;
state.soSite = 'stackoverflow';
state.soSiteName = 'Stack Overflow';
// Curated dev-relevant Stack Exchange sites; matches the server whitelist.
const SE_SITES = [
  { id: 'stackoverflow', label: 'Stack Overflow' },
  { id: 'superuser', label: 'Super User' },
  { id: 'serverfault', label: 'Server Fault' },
  { id: 'askubuntu', label: 'Ask Ubuntu' },
  { id: 'softwareengineering', label: 'Software Engineering' },
  { id: 'codereview', label: 'Code Review' },
  { id: 'unix', label: 'Unix & Linux' },
  { id: 'devops', label: 'DevOps' },
  { id: 'security', label: 'Information Security' },
  { id: 'dba', label: 'Database Admins' }
];

// Render the Stack Exchange site sub-picker once.
function buildSESites() {
  const row = $('#se-sites');
  if (!row || row.dataset.built) return;
  row.innerHTML = SE_SITES.map(s =>
    `<button class="chip${s.id === state.soSite ? ' active' : ''}" data-site="${s.id}">${esc(s.label)}</button>`).join('');
  row.dataset.built = '1';
  row.onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    $$('#se-sites .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    state.soSite = c.dataset.site;
    state.soSiteName = (SE_SITES.find(s => s.id === state.soSite) || {}).label || 'Stack Exchange';
    $('#qa-search').placeholder = `Search ${state.soSiteName}… (live)`;
    loadSO($('#qa-search').value.trim());
  };
}

$('#qa-tabs').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#qa-tabs .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.qaTab = c.dataset.qatab;
  const isSO = state.qaTab === 'so';
  $('#qa-list').classList.toggle('hidden', isSO);
  $('#so-list').classList.toggle('hidden', !isSO);
  $('#se-sites').classList.toggle('hidden', !isSO);
  $('#btn-ask').style.display = isSO ? 'none' : '';
  $('#qa-form').classList.add('hidden');
  $('#qa-search').placeholder = isSO
    ? `Search ${state.soSiteName}… (live)`
    : 'Search questions… (e.g. python, ===, borrow checker)';
  if (isSO) { buildSESites(); if (!state.soLoaded) loadSO(); }
};

async function loadSO(q = '') {
  const site = state.soSite, name = state.soSiteName;
  $('#so-list').innerHTML = `<p class="muted">Loading from ${esc(name)}…</p>`;
  try {
    const params = new URLSearchParams({ site });
    if (q) params.set('q', q);
    const data = await api('/api/so?' + params.toString());
    if (state.soSite !== site) return; // user switched sites mid-request
    state.soLoaded = true;
    const label = data.siteName || name;
    $('#so-list').innerHTML = (data.items || []).map(x => `
      <a class="card clickable q-item" href="${esc(x.link)}" target="_blank" rel="noopener" style="display:block; color:inherit">
        <span class="badge-src">${esc(label)}</span>
        <h3><span class="votes">▲ ${x.votes}</span>${esc(x.title)}</h3>
        <div class="meta">
          ${x.tags.slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
          <span>${x.answers} answer${x.answers === 1 ? '' : 's'}${x.answered ? ' · ✓ answered' : ''} · ${(x.views || 0).toLocaleString()} views · by ${esc(x.author)} · ${timeAgo(x.createdAt)}</span>
        </div>
      </a>`).join('') || `<p class="muted">No results from ${esc(label)}.</p>`;
  } catch (e) {
    $('#so-list').innerHTML = `<p class="muted">Couldn't reach ${esc(name)} (${esc(e.message)}). Try again shortly.</p>`;
  }
}

// ---------- Forums ----------
$('#btn-new-thread').onclick = () => $('#thread-form').classList.toggle('hidden');
$('#forum-cats').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#forum-cats .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  $('#thread-view').classList.add('hidden');
  $('#forum-list').classList.remove('hidden');
  htmx.ajax('GET', '/partials/forums' + (c.dataset.cat ? '?category=' + encodeURIComponent(c.dataset.cat) : ''), { target: '#forum-list', swap: 'innerHTML' });
};

// ---------- News ----------
async function loadNews() {
  try {
    const data = await api('/api/news');
    state.news = data.items;
    state.newsLoaded = true;
    $('#news-meta').textContent = data.items.length
      ? `${data.items.length} stories · updated ${timeAgo(data.fetchedAt)}`
      : '';
    const sources = [...new Set(data.items.map(i => i.source))];
    $('#news-sources').innerHTML = `<button class="chip active" data-src="">All sources</button>` +
      sources.map(s => `<button class="chip" data-src="${esc(s)}">${esc(s)}</button>`).join('');
    // Topic categories present in this batch (kept in display order).
    const present = NEWS_CAT_ORDER.filter(c => data.items.some(i => newsCategory(i) === c));
    $('#news-cats').innerHTML = `<button class="chip active" data-cat="">All topics</button>` +
      present.map(c => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    renderNews();
    renderHomeNews(data.items);
    if (data.failedFeeds?.length) $('#news-meta').textContent += ` · unavailable: ${data.failedFeeds.join(', ')}`;
  } catch (e) {
    $('#news-list').innerHTML = `<p class="muted">Couldn't load news feeds (${esc(e.message)}). Check your internet connection and reload.</p>`;
  }
}
function renderHomeNews(items) {
  if (!items.length) return;
  // Ticker: top headlines, duplicated for a seamless infinite scroll
  const tickerItems = items.slice(0, 8)
    .map(i => `<span>■ ${esc(i.title)}</span>`).join('');
  $('#ticker').innerHTML = tickerItems + tickerItems;
  // Featured pair under the hero
  $('#home-featured').innerHTML = items.slice(0, 2).map(i => `
    <a href="${esc(i.link)}" target="_blank" rel="noopener" style="color:inherit">
      <span class="badge-src">${esc(i.source)}</span>
      <h3>${esc(i.title)}</h3>
      <span class="muted">${timeAgo(i.date)}</span>
    </a>`).join('');
  // Latest rail
  $('#home-rail').innerHTML = items.slice(2, 11).map(i => `
    <a class="rail-item" href="${esc(i.link)}" target="_blank" rel="noopener">
      <div>
        <h4>${esc(i.title)}</h4>
        <div class="meta">${esc(i.source)} · ${timeAgo(i.date)}</div>
      </div>
    </a>`).join('');
}
const newsCard = i => `
  <a class="card clickable" href="${esc(i.link)}" target="_blank" rel="noopener" style="display:block; color:inherit">
    <span class="badge-src">${esc(i.source)}</span>
    <h3 style="margin-top:8px">${esc(i.title)}</h3>
    <p class="muted">${esc(i.snippet)}</p>
    <div class="meta"><span>${timeAgo(i.date)}</span></div>
  </a>`;
// ---------- News topic categories ----------
// Classify each story into a topic from its title + snippet (with a source hint).
const NEWS_CAT_ORDER = ['AI & ML', 'Developer', 'Business', 'Security', 'Science & Health', 'Gadgets', 'General Tech'];
const NEWS_CAT_ICON = { 'AI & ML': '🤖', 'Developer': '💻', 'Business': '📈', 'Security': '🔒', 'Science & Health': '🔬', 'Gadgets': '📱', 'General Tech': '🌐' };
const NEWS_CAT_RULES = [
  ['AI & ML', /\b(a\.?i\.?|artificial intelligence|machine learning|\bml\b|llm|gpt|openai|anthropic|gemini|copilot|chatbot|neural|agentic|deep learning)\b/i],
  ['Security', /\b(security|vulnerabilit|breach|hack(?:ed|er|ing)?|exploit|malware|ransomware|\bcve\b|zero-?day|phishing|encryption|0-?day)\b/i],
  ['Developer', /\b(programming|coding|developer|javascript|typescript|python|golang|rust|react|node\.?js|\bapi\b|framework|github|kubernetes|docker|algorithm|compiler|open-?source|devops|database|\bsql\b)\b/i],
  ['Business', /\b(startup|funding|fundrais|ipo|revenue|\bceo\b|acquisition|valuation|layoff|stock|billion|venture|investor|earnings|hustle|side hustle)\b/i],
  ['Science & Health', /\b(science|health|medical|cancer|disease|nasa|space|physics|quantum|biolog|vaccine|parasite|surgery|outbreak|climate)\b/i],
  ['Gadgets', /\b(phone|android|iphone|ipad|laptop|headphone|speaker|gadget|deal|promo code|coupon|wearable|smart home|thermostat|galaxy|pixel|bluetooth)\b/i],
];
const NEWS_DEV_SOURCES = new Set(['Dev.to', 'freeCodeCamp', 'GeeksforGeeks', 'takeUforward', 'Scaler', 'TechGig', 'Medium']);
function newsCategory(i) {
  const t = (i.title || '') + ' ' + (i.snippet || '');
  for (const [cat, re] of NEWS_CAT_RULES) if (re.test(t)) return cat;
  if (NEWS_DEV_SOURCES.has(i.source)) return 'Developer';
  return 'General Tech';
}

function renderNews() {
  let items = state.newsFilter ? state.news.filter(i => i.source === state.newsFilter) : state.news;
  if (!items.length) { $('#news-list').innerHTML = '<p class="muted">No stories.</p>'; return; }

  if (state.newsCategory) {
    // Single topic: flat grid.
    const list = items.filter(i => newsCategory(i) === state.newsCategory).slice(0, 60);
    $('#news-list').innerHTML = list.length
      ? `<div class="grid-2">${list.map(newsCard).join('')}</div>`
      : '<p class="muted">No stories in this topic right now.</p>';
    return;
  }

  // All topics: group into labeled sections in display order.
  const groups = {};
  items.forEach(i => { (groups[newsCategory(i)] ||= []).push(i); });
  const html = NEWS_CAT_ORDER.filter(c => groups[c] && groups[c].length).map(c => `
    <section class="news-cat-block">
      <h2 class="news-cat-title">${NEWS_CAT_ICON[c]} ${esc(c)} <span>${groups[c].length}</span></h2>
      <div class="grid-2">${groups[c].slice(0, 12).map(newsCard).join('')}</div>
    </section>`).join('');
  $('#news-list').innerHTML = html || '<p class="muted">No stories.</p>';
}

$('#news-sources').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#news-sources .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.newsFilter = c.dataset.src;
  renderNews();
};

// ---------- Health news ----------
// Classify each health story into a topic from its title + snippet.
const HEALTH_CAT_ORDER = ['Research & Discovery', 'Diseases & Conditions', 'Mental Health', 'Nutrition & Fitness', 'Medicine & Treatment', 'Public Health & Policy', 'General Health'];
const HEALTH_CAT_ICON = { 'Research & Discovery': '🔬', 'Diseases & Conditions': '🩺', 'Mental Health': '🧠', 'Nutrition & Fitness': '🥗', 'Medicine & Treatment': '💊', 'Public Health & Policy': '🏛️', 'General Health': '❤️' };
const HEALTH_CAT_RULES = [
  ['Mental Health', /\b(mental health|anxiety|depress|psycholog|psychiatr|well-?being|burnout|mindful|\bptsd\b|suicid|loneliness|\bbrain\b)\b/i],
  ['Nutrition & Fitness', /\b(nutrition|diet|dietary|food|eating|obesity|weight|exercise|fitness|workout|\bsleep\b|calorie|vitamin|supplement|protein|sugar)\b/i],
  ['Diseases & Conditions', /\b(cancer|diabet|heart|cardio|stroke|alzheimer|dementia|covid|influenza|\bflu\b|virus|infection|disease|disorder|asthma|arthritis|hypertension|tumou?r|parasite|measles)\b/i],
  ['Medicine & Treatment', /\b(drug|treatment|therap|medication|vaccine|surger|clinical trial|\bfda\b|approval|antibiotic|gene[- ]editing|transplant)\b/i],
  ['Public Health & Policy', /\b(public health|policy|\bwho\b|\bcdc\b|outbreak|epidemic|pandemic|health ?care|insurance|medicaid|medicare|hospital|regulat|equity|access to care)\b/i],
  ['Research & Discovery', /\b(stud(y|ies)|research|scientist|discover|finding|trial|experiment|breakthrough|evidence|linked to|may (help|reduce|cause))\b/i]
];
function healthCategory(i) {
  const t = (i.title || '') + ' ' + (i.snippet || '');
  for (const [cat, re] of HEALTH_CAT_RULES) if (re.test(t)) return cat;
  return 'General Health';
}

async function loadHealth() {
  try {
    const data = await api('/api/health-news');
    state.health = data.items;
    state.healthLoaded = true;
    $('#health-meta').textContent = data.items.length
      ? `${data.items.length} stories · updated ${timeAgo(data.fetchedAt)}`
      : '';
    const sources = [...new Set(data.items.map(i => i.source))];
    $('#health-sources').innerHTML = `<button class="chip active" data-src="">All sources</button>` +
      sources.map(s => `<button class="chip" data-src="${esc(s)}">${esc(s)}</button>`).join('');
    const present = HEALTH_CAT_ORDER.filter(c => data.items.some(i => healthCategory(i) === c));
    $('#health-cats').innerHTML = `<button class="chip active" data-cat="">All topics</button>` +
      present.map(c => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    renderHealth();
    if (data.failedFeeds?.length) $('#health-meta').textContent += ` · unavailable: ${data.failedFeeds.join(', ')}`;
  } catch (e) {
    $('#health-list').innerHTML = `<p class="muted">Couldn't load health feeds (${esc(e.message)}). Reload to try again.</p>`;
  }
}
function renderHealth() {
  let items = state.healthFilter ? state.health.filter(i => i.source === state.healthFilter) : state.health;
  if (!items.length) { $('#health-list').innerHTML = '<p class="muted">No stories.</p>'; return; }
  if (state.healthCategory) {
    const list = items.filter(i => healthCategory(i) === state.healthCategory).slice(0, 60);
    $('#health-list').innerHTML = list.length
      ? `<div class="grid-2">${list.map(newsCard).join('')}</div>`
      : '<p class="muted">No stories in this topic right now.</p>';
    return;
  }
  const groups = {};
  items.forEach(i => { (groups[healthCategory(i)] ||= []).push(i); });
  const html = HEALTH_CAT_ORDER.filter(c => groups[c] && groups[c].length).map(c => `
    <section class="news-cat-block">
      <h2 class="news-cat-title">${HEALTH_CAT_ICON[c]} ${esc(c)} <span>${groups[c].length}</span></h2>
      <div class="grid-2">${groups[c].slice(0, 12).map(newsCard).join('')}</div>
    </section>`).join('');
  $('#health-list').innerHTML = html || '<p class="muted">No stories.</p>';
}
$('#health-sources').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#health-sources .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.healthFilter = c.dataset.src;
  renderHealth();
};
$('#health-cats').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#health-cats .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.healthCategory = c.dataset.cat;
  renderHealth();
};
$('#news-cats').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#news-cats .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.newsCategory = c.dataset.cat;
  renderNews();
};

// ---------- Advertise ----------
async function loadAds() {
  const pkgs = await api('/api/ads/packages');
  state.pkgs = pkgs;
  const cats = [...new Set(pkgs.map(p => p.category))];
  $('#ad-cats').innerHTML = `<button class="chip active" data-cat="">All</button>` +
    cats.map(c => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  renderAds('');
  $('#ad-cats').onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    $$('#ad-cats .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    renderAds(c.dataset.cat);
  };
}
function renderAds(cat) {
  const list = cat ? state.pkgs.filter(p => p.category === cat) : state.pkgs;
  $('#ad-grid').innerHTML = list.map(p => `
    <div class="ad-card">
      <div class="ad-cat-label">${esc(p.category)}</div>
      <h3>${esc(p.name)}</h3>
      <div class="price">$${p.price}<small>${esc(p.period)}</small></div>
      <p class="muted" style="margin:8px 0">${esc(p.desc)}</p>
      ${p.perks.map(x => `<div class="perk">${esc(x)}</div>`).join('')}
      <button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="pickAd('${p.id}')">Book Now</button>
    </div>`).join('');
}
window.pickAd = id => {
  const p = state.pkgs.find(x => x.id === id);
  $('#ad-package-id').value = id;                 // htmx form submits this hidden field
  $('#ad-form').classList.remove('hidden');
  $('#ad-form-title').textContent = `Book: ${p.name} — $${p.price}${p.period}`;
  $('#ad-result').textContent = '';
  $('#ad-form').scrollIntoView({ behavior: 'smooth' });
};

// ---------- Agentic Ad Assistant ("Blaze") ----------
// A goal-driven booking agent: it collects a campaign brief, scores packages
// server-side against each ad's rules, recommends the best fit, then books it
// while enforcing placement rules (word/link limits, required tag, creative).
const AA = {
  started: false,
  stage: 'idle',
  brief: { goals: [], goalLabel: '', budget: null, tag: null, duration: null, text: '' },
  pkg: null,
  booking: { company: '', email: '', copy: '' }
};

const AA_GOALS = [
  { keys: ['awareness'],                          label: 'Brand awareness' },
  { keys: ['traffic'],                            label: 'Clicks & signups' },
  { keys: ['email'],                              label: 'Reach dev inboxes' },
  { keys: ['targeting', 'niche'],                 label: 'Target a language' },
  { keys: ['community', 'engagement'],            label: 'Community engagement' },
  { keys: ['content', 'seo', 'thought-leadership'], label: 'Content / authority' },
  { keys: ['launch', 'maximum'],                  label: 'Big launch / max reach' }
];
const AA_BUDGETS = [
  { label: 'Under $200', val: 150 },
  { label: '$200–$500',  val: 450 },
  { label: '$500–$800',  val: 750 },
  { label: '$800+',      val: 1200 }
];
const AA_TAGS = ['python','javascript','typescript','java','c++','go','rust','c#','php','swift','kotlin','sql','ruby'];
const AA_TAG_RULE = { 'text-link': 10, newsletter: 50, sidebar: 20, 'home-banner': 15, 'news-slot': 25, 'qa-sponsor': 12 };

const aaLog = () => $('#assistant-log');
function aaScroll() { const l = aaLog(); l.scrollTop = l.scrollHeight; }
function aaAdd(role, html) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = html;
  aaLog().appendChild(div);
  aaScroll();
  return div;
}
function aaTyping() {
  return aaAdd('bot', '<span class="typing"><span></span><span></span><span></span></span>');
}
async function aaBot(html, delay = 500) {
  const t = aaTyping();
  await new Promise(r => setTimeout(r, delay));
  t.innerHTML = html;
  aaScroll();
  return t;
}
function aaQuick(items) {
  const q = $('#assistant-quick');
  q.innerHTML = '';
  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = it.label;
    b.onclick = () => { aaClearQuick(); it.onClick(); };
    q.appendChild(b);
  });
}
function aaClearQuick() { $('#assistant-quick').innerHTML = ''; }

async function aaStart() {
  if (AA.started) return;
  AA.started = true;
  aaLog().innerHTML = '';
  aaClearQuick();
  await aaBot("Hi, I'm <strong>Blaze</strong> ✦ your ad assistant. In a couple of questions I'll match you to the right package and get it booked. <strong>What's the main goal of your campaign?</strong>", 300);
  aaAskGoal();
}
function aaAskGoal() {
  AA.stage = 'goal';
  aaQuick(AA_GOALS.map(g => ({ label: g.label, onClick: () => aaSetGoal(g) })));
}
async function aaSetGoal(g) {
  AA.brief.goals = g.keys.slice();
  AA.brief.goalLabel = g.label;
  aaAdd('user', esc(g.label));
  await aaAskBudget();
}
async function aaAskBudget() {
  AA.stage = 'budget';
  await aaBot("Great. <strong>What's your rough budget?</strong> (you can type a number too)", 450);
  aaQuick(AA_BUDGETS.map(b => ({ label: b.label, onClick: () => aaSetBudget(b.val, b.label) })));
}
async function aaSetBudget(val, label) {
  AA.brief.budget = val;
  aaAdd('user', esc(label || ('$' + val)));
  // Only ask for a tag when the goal is about targeting a specific language.
  if (AA.brief.goals.some(k => k === 'targeting' || k === 'niche')) return aaAskTag();
  await aaRecommend();
}
async function aaAskTag() {
  AA.stage = 'tag';
  await aaBot("Which language or tech should we target?", 400);
  aaQuick(AA_TAGS.slice(0, 8).map(t => ({ label: '#' + t, onClick: () => aaSetTag(t) }))
    .concat([{ label: 'No preference', onClick: () => aaSetTag(null) }]));
}
async function aaSetTag(t) {
  AA.brief.tag = t;
  aaAdd('user', t ? '#' + esc(t) : 'No preference');
  await aaRecommend();
}
async function aaRecommend() {
  AA.stage = 'recommend';
  const t = aaTyping();
  try {
    const payload = {
      goals: AA.brief.goals, budget: AA.brief.budget, tag: AA.brief.tag,
      text: AA.brief.text || AA.brief.goalLabel
    };
    const data = await api('/api/ads/assistant/recommend', { method: 'POST', body: JSON.stringify(payload) });
    const top = (data.top && data.top.length) ? data.top : data.all.slice(0, 3);
    const intro = top.length
      ? `Based on <strong>${esc(AA.brief.goalLabel || 'your goal')}</strong>${AA.brief.budget ? ` and a ~$${AA.brief.budget} budget` : ''}, here's what I'd recommend:`
      : "I couldn't find a strong match — here are our closest options:";
    t.innerHTML = intro + top.map((r, i) => aaRecCard(r, i === 0)).join('');
    aaScroll();
    AA.stage = 'picking';
  } catch (e) {
    t.innerHTML = "Sorry, I couldn't reach the recommendation service (" + esc(e.message) + "). You can browse the packages below instead.";
  }
}
function aaRecCard(r, isTop) {
  return `
    <div class="rec ${isTop ? 'top' : ''}">
      <div class="rec-head">
        <b>${esc(r.name)}${isTop ? '<span class="rec-badge">Best fit</span>' : ''}</b>
        <span class="rec-price">$${r.price}${esc(r.period)}</span>
      </div>
      <ul>${(r.reasons || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <button class="btn btn-primary btn-sm" onclick="aaPick('${r.id}','${esc(r.name)}',${r.price},'${esc(r.period)}')">Book ${esc(r.name)}</button>
    </div>`;
}
window.aaPick = async (id, name, price, period) => {
  AA.pkg = { id, name, price, period };
  aaClearQuick();
  aaAdd('user', 'Book ' + esc(name));
  AA.stage = 'company';
  await aaBot(`Excellent — <strong>${esc(name)}</strong> ($${price}${esc(period)}). Let's get the details. <strong>What's your company name?</strong>`, 450);
};

// Handle context-sensitive free-text input for the booking flow.
async function aaHandleText(text) {
  const val = text.trim();
  if (!val) return;

  switch (AA.stage) {
    case 'goal': {
      aaAdd('user', esc(val));
      AA.brief.text = val; AA.brief.goalLabel = val; AA.brief.goals = [];
      const b = /\$?\s*\d{2,6}|\bk\b/.test(val) ? null : null; // budget still asked next
      await aaAskBudget();
      break;
    }
    case 'budget': {
      const n = aaParseBudget(val);
      aaAdd('user', esc(val));
      if (n == null) { await aaBot("I didn't catch a number — roughly how many dollars? e.g. 500", 300); return; }
      await aaSetBudget(n, '$' + n);
      break;
    }
    case 'tag': {
      const found = AA_TAGS.find(t => val.toLowerCase().includes(t));
      await aaSetTag(found || null);
      break;
    }
    case 'company': {
      AA.booking.company = val.slice(0, 100);
      aaAdd('user', esc(val));
      AA.stage = 'email';
      await aaBot("Thanks. <strong>What's the best work email</strong> to send the confirmation to?", 350);
      break;
    }
    case 'email': {
      aaAdd('user', esc(val));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { await aaBot("That doesn't look like a valid email — mind trying again?", 300); return; }
      AA.booking.email = val.slice(0, 100);
      // Ask for the tag if this package requires one and we don't have it yet.
      if (AA.pkg.id === 'qa-sponsor' && !AA.brief.tag) {
        AA.stage = 'tag-book';
        await aaBot("Which language tag should your brand run on? e.g. #python", 350);
        return;
      }
      await aaAskCopy();
      break;
    }
    case 'tag-book': {
      const found = AA_TAGS.find(t => val.toLowerCase().includes(t));
      AA.brief.tag = found || val.replace(/^#/, '').toLowerCase().slice(0, 40);
      aaAdd('user', '#' + esc(AA.brief.tag));
      await aaAskCopy();
      break;
    }
    case 'copy':
    case 'copy-fix': {
      aaAdd('user', esc(val));
      if (/^(book anyway|book it|go ahead|submit)$/i.test(val)) { await aaBook(AA.booking.copy); return; }
      AA.booking.copy = val.slice(0, 2000);
      await aaBook(val);
      break;
    }
    case 'done': {
      aaAdd('user', esc(val));
      await aaBot("We're all set on that booking! Hit <strong>Restart</strong> above to plan another campaign.", 300);
      break;
    }
    default:
      aaAdd('user', esc(val));
      await aaBot("Let me get you set up first — tell me your campaign goal.", 250);
      aaAskGoal();
  }
}
function aaParseBudget(s) {
  const t = String(s).toLowerCase().replace(/,/g, '');
  const k = t.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const n = t.match(/\$?\s*(\d{2,6})/);
  return n ? parseInt(n[1], 10) : null;
}
async function aaAskCopy() {
  AA.stage = 'copy';
  const limit = AA_TAG_RULE[AA.pkg.id];
  const hint = limit
    ? ` Heads up: ${AA.pkg.name} allows up to <strong>${limit} words</strong> and one link, so keep it tight.`
    : '';
  await aaBot(`Almost done. <strong>Paste your ad copy or a short creative note</strong> and I'll check it against the ${esc(AA.pkg.name)} rules.${hint}`, 400);
}
async function aaBook(copy) {
  const t = aaTyping();
  try {
    const body = {
      packageId: AA.pkg.id,
      company: AA.booking.company,
      email: AA.booking.email,
      goal: AA.brief.goalLabel,
      budget: AA.brief.budget,
      tag: AA.brief.tag,
      copy: copy || '',
      message: copy || ''
    };
    const r = await api('/api/ads/inquiries', { method: 'POST', body: JSON.stringify(body) });
    let html = '✅ ' + esc(r.note);
    if (r.warnings && r.warnings.length) {
      html += '<div style="margin-top:8px"><span class="assistant-warn">Please review:</span><ul>' +
        r.warnings.map(w => `<li>${esc(w)}</li>`).join('') + '</ul></div>';
    }
    if (r.notes && r.notes.length) {
      html += '<div style="margin-top:6px"><span class="assistant-ok">Good to know:</span><ul>' +
        r.notes.map(n => `<li>${esc(n)}</li>`).join('') + '</ul></div>';
    }
    t.innerHTML = html;
    aaScroll();
    if (r.warnings && r.warnings.length) {
      AA.stage = 'copy-fix';
      await aaBot("Want to paste a revised version, or type <strong>book anyway</strong> to keep it as-is?", 300);
    } else {
      AA.stage = 'done';
      aaQuick([{ label: 'Plan another campaign', onClick: () => { AA.started = false; AA.pkg = null; AA.brief = { goals: [], goalLabel: '', budget: null, tag: null, duration: null, text: '' }; AA.booking = { company: '', email: '', copy: '' }; aaStart(); } }]);
    }
  } catch (e) {
    t.innerHTML = '❌ ' + esc(e.message);
  }
}

// Wire the assistant form + restart button.
(function aaWire() {
  const form = $('#assistant-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#assistant-text');
    const v = input.value;
    input.value = '';
    aaHandleText(v);
  });
  $('#assistant-reset').addEventListener('click', () => {
    AA.started = false; AA.pkg = null;
    AA.brief = { goals: [], goalLabel: '', budget: null, tag: null, duration: null, text: '' };
    AA.booking = { company: '', email: '', copy: '' };
    aaStart();
  });
})();

// ---------- Home trending ----------
async function loadTrending() {
  const qs = state.questions.slice().sort((a,b) => b.votes - a.votes).slice(0, 3);
  $('#home-trending').innerHTML = qs.map(q => `
    <div class="card clickable" onclick="nav_qa()">
      <span class="tag">${esc(q.tags[0] || 'general')}</span>
      <h3 style="margin-top:8px">${esc(q.title)}</h3>
      <div class="meta"><span>▲ ${q.votes} · ${q.answers.length} answers</span></div>
    </div>`).join('');
}
window.nav_qa = () => nav('qa');

// ---------- Total visitors ----------
async function loadVisits() {
  const el = document.getElementById('visit-count');
  if (!el) return;
  try {
    let counted = false;
    try { counted = !!localStorage.getItem('cbf-counted'); } catch (e) {}
    // Count this browser once; otherwise just read the running total.
    const data = counted
      ? await api('/api/visits')
      : await api('/api/visits', { method: 'POST', body: '{}' });
    if (!counted) { try { localStorage.setItem('cbf-counted', '1'); } catch (e) {} }
    el.textContent = Number(data.count || 0).toLocaleString();
  } catch (e) { el.textContent = '—'; }
}

// ---------- Init ----------
(async function init() {
  loadVisits();
  await Promise.all([loadLanguages(), loadStats(), loadAds()]);
  loadTrending();
  loadNews(); // background, also fills home preview
})();

// ---------- J.A.R.V.I.S. — agentic briefing assistant ----------
(function initJarvis() {
  const orb = document.getElementById('jarvis-orb');
  const panel = document.getElementById('jarvis-panel');
  if (!orb || !panel) return;
  const logEl = document.getElementById('jarvis-log');
  const statusEl = document.getElementById('jarvis-status');
  const quickEl = document.getElementById('jarvis-quick');
  const muteBtn = document.getElementById('jarvis-mute');
  const micBtn = document.getElementById('jarvis-mic');
  const form = document.getElementById('jarvis-form');
  const textEl = document.getElementById('jarvis-text');

  let muted = false;
  try { muted = localStorage.getItem('jarvis-muted') === '1'; } catch (e) {}
  muteBtn.textContent = muted ? '🔇' : '🔊';
  let greeted = false;
  const cache = {};

  const status = s => { statusEl.textContent = s; };
  const scroll = () => { logEl.scrollTop = logEl.scrollHeight; };
  function add(role, html) { const d = document.createElement('div'); d.className = 'jmsg ' + role; d.innerHTML = html; logEl.appendChild(d); scroll(); return d; }

  // Voice output
  let voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    // Prefer an Indian-origin voice: Indian English first, then named Indian
    // voices, then an Indian Hindi voice, before falling back to UK/US.
    voice = vs.find(v => /en[-_]IN/i.test(v.lang) && /ravi|rishi|prabhat|hemant|male/i.test(v.name))
      || vs.find(v => /en[-_]IN/i.test(v.lang))
      || vs.find(v => /(rishi|ravi|veena|heera|aditi|kajal|india|indian)/i.test(v.name))
      || vs.find(v => /hi[-_]IN/i.test(v.lang))
      || vs.find(v => /en-GB/i.test(v.lang))
      || vs.find(v => /en[-_]US/i.test(v.lang)) || vs[0] || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (muted || !text || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = (voice && voice.lang) || 'en-IN';   // hint Indian pronunciation
      u.rate = 1.0; u.pitch = 0.95;
      u.onstart = () => orb.classList.add('jarvis-speaking');
      u.onend = () => orb.classList.remove('jarvis-speaking');
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function say(html, spoken) {
    add('bot', html);
    speak(spoken != null ? spoken : html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  async function jFetch(url) {
    const c = cache[url];
    if (c && Date.now() - c.t < 5 * 60 * 1000) return c.data;
    const data = await api(url);
    cache[url] = { t: Date.now(), data };
    return data;
  }
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning, sir.' : h < 18 ? 'Good afternoon, sir.' : 'Good evening, sir.'; };
  const topCats = (items, fn) => { const m = {}; items.forEach(i => { const c = fn(i); m[c] = (m[c] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const li = i => `<li><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a> <span class="muted">— ${esc(i.source)}</span></li>`;

  // Show a "thinking" bubble while a task runs, then replace it with the result.
  function thinking() { return add('bot', '<span class="jdots"><span></span><span></span><span></span></span>'); }
  async function run(statusText, worker, errMsg) {
    const t = thinking(); status(statusText); orb.classList.add('jarvis-working');
    try { const r = await worker(); t.remove(); say(r.html, r.spoken); }
    catch (e) { t.remove(); say(errMsg || 'I could not complete that, sir.'); }
    finally { status('At your service.'); orb.classList.remove('jarvis-working'); }
  }

  const brief = () => run('Scanning the feeds…', async () => {
    const [news, health, qs] = await Promise.all([jFetch('/api/news'), jFetch('/api/health-news'), jFetch('/api/questions')]);
    const nItems = news.items || [], hItems = health.items || [];
    const cats = topCats(nItems, newsCategory).slice(0, 3).map(([c, n]) => `${c} (${n})`);
    const hcats = topCats(hItems, healthCategory).slice(0, 2).map(([c]) => c);
    const topQ = (qs || []).slice().sort((a, b) => b.votes - a.votes)[0];
    const g = greeting();
    const spoken = `${g} Here is your briefing. I am tracking ${nItems.length} technology stories and ${hItems.length} health stories. The most active topics are ${cats.join(', ') || 'various'}. Today's leading headline: ${(nItems[0] || {}).title || 'unavailable'}.`;
    const html = `<strong>${g}</strong> Here's your briefing:<br><br>`
      + `<b>📡 Tech</b> — ${nItems.length} stories · hottest: ${cats.join(', ') || '—'}<ul>${nItems.slice(0, 5).map(li).join('')}</ul>`
      + `<b>🩺 Health</b> — ${hItems.length} stories${hcats.length ? ' · ' + hcats.join(', ') : ''}<ul>${hItems.slice(0, 3).map(li).join('') || '<li class="muted">none</li>'}</ul>`
      + `<b>💬 Community</b> — top question: "${esc(topQ ? topQ.title : '—')}" (${topQ ? topQ.votes : 0} votes)<br>`
      + `<span class="muted">Try “read in detail”, “health”, or “trending”.</span>`;
    return { html, spoken };
  }, 'I could not reach the feeds, sir.');

  const newsTop = () => run('Fetching headlines…', async () => {
    const d = await jFetch('/api/news'); const it = (d.items || []).slice(0, 6);
    return { html: `Top technology headlines, sir:<ul>${it.map(li).join('')}</ul>`, spoken: `The top headline is: ${(it[0] || {}).title || 'unavailable'}.` };
  }, 'The feeds are unreachable, sir.');

  const healthTop = () => run('Fetching health…', async () => {
    const d = await jFetch('/api/health-news'); const it = (d.items || []).slice(0, 6);
    return { html: `Top health headlines, sir:<ul>${it.map(li).join('')}</ul>`, spoken: `The leading health story: ${(it[0] || {}).title || 'unavailable'}.` };
  }, 'The health feeds are unreachable, sir.');

  const readDetails = () => run('Reading the top stories…', async () => {
    const d = await jFetch('/api/news'); const it = (d.items || []).slice(0, 3);
    const html = `In detail, sir:<ul>${it.map(i => `<li><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a><br><span class="muted">${esc((i.snippet || '').slice(0, 170)) || 'No summary available.'}</span></li>`).join('')}</ul>`;
    const spoken = it.map((i, n) => `Story ${n + 1}: ${i.title}. ${(i.snippet || '').slice(0, 140)}`).join(' ') || 'No stories available, sir.';
    return { html, spoken };
  }, 'The feeds are unreachable, sir.');

  const trending = () => run('Checking the community…', async () => {
    const qs = await jFetch('/api/questions'); const top = (qs || []).slice().sort((a, b) => b.votes - a.votes).slice(0, 5);
    return { html: `The most upvoted questions, sir:<ul>${top.map(q => `<li>${esc(q.title)} <span class="muted">▲ ${q.votes}</span></li>`).join('')}</ul>`, spoken: `The top question: ${(top[0] || {}).title || 'none yet'}.` };
  }, 'I could not reach the Q&A, sir.');

  const forumsTop = () => run('Checking the forums…', async () => {
    const ts = await jFetch('/api/forums'); const top = (ts || []).slice().sort((a, b) => b.views - a.views).slice(0, 5);
    return { html: `The busiest forum threads, sir:<ul>${top.map(t => `<li>${esc(t.title)} <span class="muted">👁 ${t.views}</span></li>`).join('')}</ul>`, spoken: `The most viewed thread: ${(top[0] || {}).title || 'none'}.` };
  }, 'I could not reach the forums, sir.');

  const languagesInfo = () => run('Reviewing the languages…', async () => {
    const langs = await jFetch('/api/languages'); const names = (langs || []).map(l => l.name);
    return { html: `We cover <b>${names.length}</b> languages, sir:<br>${names.map(n => `<span class="jtag">${esc(n)}</span>`).join(' ')}`, spoken: `We cover ${names.length} languages, including ${names.slice(0, 5).join(', ')}.` };
  }, 'I could not load the languages, sir.');

  const search = (q) => run('Searching the feeds…', async () => {
    const [news, health] = await Promise.all([jFetch('/api/news'), jFetch('/api/health-news')]);
    const all = (news.items || []).concat(health.items || []);
    const ql = q.toLowerCase();
    const hits = all.filter(i => (i.title + ' ' + (i.snippet || '')).toLowerCase().includes(ql)).slice(0, 6);
    if (hits.length) return { html: `Here's what I found on "${esc(q)}", sir:<ul>${hits.map(li).join('')}</ul>`, spoken: `I found ${hits.length} stories on ${q}.` };
    return { html: `I found nothing on "${esc(q)}" in today's feeds, sir. Try “brief me”, “top news”, “health”, or “trending”.`, spoken: `I found nothing on ${q}, sir.` };
  }, 'The search failed, sir.');

  function stopSpeaking() { try { speechSynthesis.cancel(); } catch (e) {} orb.classList.remove('jarvis-speaking'); add('bot', 'Silenced, sir.'); }

  function help() {
    say(`At your command, sir. I can:<ul><li><b>brief me</b> — a full rundown</li><li><b>top news</b> / <b>health</b> — latest headlines</li><li><b>read in detail</b> — top stories with summaries</li><li><b>trending</b> — hottest questions · <b>forums</b> — busiest threads</li><li><b>languages</b> — what we cover</li><li>ask about a topic (<i>“anything on AI?”</i>) or say <b>stop</b> to silence me</li></ul>`, 'I can brief you, read stories in detail, and report on news, health, trending questions, forums, and languages, sir.');
  }

  function route(raw) {
    const q = (raw || '').trim(); if (!q) return;
    add('user', esc(q));
    const t = q.toLowerCase();
    if (/\b(stop|silence|quiet|shush|shut up|enough)\b/.test(t)) return stopSpeaking();
    if (/\b(brief|briefing|report|overview|catch me up|rundown|what'?s (new|up|happening|going on)|good (morning|afternoon|evening)|status)\b/.test(t)) return brief();
    if (/\b(read|in detail|details?|tell me more|more detail|elaborate|summar)\b/.test(t)) return readDetails();
    if (/\b(language|languages)\b/.test(t)) return languagesInfo();
    if (/\b(health|medical|medicine|disease|wellness)\b/.test(t)) return healthTop();
    if (/\b(trend|question|q ?& ?a|q and a|upvot)\b/.test(t)) return trending();
    if (/\b(forum|thread|discuss)\b/.test(t)) return forumsTop();
    if (/\b(news|headline|top stor|latest)\b/.test(t)) return newsTop();
    if (/\b(help|what can you|commands?|who are you)\b/.test(t)) return help();
    return search(q.replace(/^(any(thing)?( on| about)?|tell me about|find|search|news on|what about)\s+/i, '').replace(/[?.!]+$/, '') || q);
  }

  function open() {
    panel.classList.add('open'); textEl.focus();
    if (!greeted) { greeted = true; setTimeout(() => say(`${greeting()} GARUDA online. Say “brief me” for today's rundown.`, `${greeting()} Garuda online. How may I assist?`), 250); }
  }
  function close() { panel.classList.remove('open'); try { speechSynthesis.cancel(); } catch (e) {} orb.classList.remove('jarvis-speaking'); }
  orb.addEventListener('click', () => panel.classList.contains('open') ? close() : open());
  document.getElementById('jarvis-close').addEventListener('click', close);
  muteBtn.addEventListener('click', () => { muted = !muted; muteBtn.textContent = muted ? '🔇' : '🔊'; try { localStorage.setItem('jarvis-muted', muted ? '1' : '0'); } catch (e) {} if (muted) { try { speechSynthesis.cancel(); } catch (e) {} } });
  form.addEventListener('submit', e => { e.preventDefault(); const v = textEl.value; textEl.value = ''; route(v); });

  [['Brief me', 'brief me'], ['Top news', 'top news'], ['Health', 'health'], ['Trending', 'trending'], ['Forums', 'forums']].forEach(([label, cmd]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => route(cmd); quickEl.appendChild(b);
  });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    let listening = false;
    micBtn.addEventListener('click', () => { try { listening ? rec.stop() : rec.start(); } catch (e) {} });
    rec.onstart = () => { listening = true; micBtn.classList.add('listening'); status('Listening…'); };
    rec.onend = () => { listening = false; micBtn.classList.remove('listening'); if (statusEl.textContent === 'Listening…') status('At your service.'); };
    rec.onerror = () => { listening = false; micBtn.classList.remove('listening'); status('At your service.'); };
    rec.onresult = e => route(e.results[0][0].transcript);
  } else { micBtn.style.display = 'none'; }
})();

// ---------- UI/UX polish: back-to-top + Escape shortcuts ----------
(function initUX() {
  const toTop = document.getElementById('to-top');
  if (toTop) {
    const onScroll = () => toTop.classList.toggle('show', window.scrollY > 500);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }
  // Escape closes GARUDA, then the mobile menu.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const jp = document.getElementById('jarvis-panel');
    if (jp && jp.classList.contains('open')) { jp.classList.remove('open'); try { speechSynthesis.cancel(); } catch (_) {} return; }
    const nv = document.getElementById('site-nav');
    if (nv && nv.classList.contains('open')) { nv.classList.remove('open'); const tg = document.getElementById('nav-toggle'); if (tg) tg.setAttribute('aria-expanded', 'false'); }
  });
})();

// ---------- Hospitality feeds ----------
async function loadHospitality() {
  try {
    const data = await api('/api/hospitality-news');
    state.hospitality = data.items;
    state.hospitalityLoaded = true;
    $('#hosp-meta').textContent = data.items.length
      ? `${data.items.length} stories · updated ${timeAgo(data.fetchedAt)}`
      : '';
    const sources = [...new Set(data.items.map(i => i.source))];
    $('#hosp-sources').innerHTML = `<button class="chip active" data-src="">All sources</button>` +
      sources.map(s => `<button class="chip" data-src="${esc(s)}">${esc(s)}</button>`).join('');
    renderHospitality();
    if (data.failedFeeds?.length) $('#hosp-meta').textContent += ` · unavailable: ${data.failedFeeds.join(', ')}`;
  } catch (e) {
    $('#hosp-list').innerHTML = `<p class="muted">Couldn't load hospitality feeds (${esc(e.message)}). Reload to try again.</p>`;
  }
}
function renderHospitality() {
  const items = state.hospitalityFilter ? state.hospitality.filter(i => i.source === state.hospitalityFilter) : state.hospitality;
  $('#hosp-list').innerHTML = items.slice(0, 60).map(newsCard).join('') || '<p class="muted">No stories.</p>';
}
$('#hosp-sources').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#hosp-sources .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.hospitalityFilter = c.dataset.src;
  renderHospitality();
};

// ---------- Home page live clock ----------
(function initClock() {
  const el = document.getElementById('home-clock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    const date = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = `🕒 ${date} · ${time}`;
  };
  tick();
  setInterval(tick, 1000);
})();

// ---------- Rotating hero (revolves through the site's categories) ----------
(function initHeroRotator() {
  const copy = document.getElementById('hero-copy');
  const dotsEl = document.getElementById('hero-dots');
  const kEl = document.getElementById('hero-kicker');
  const tEl = document.getElementById('hero-title');
  const dEl = document.getElementById('hero-dek');
  if (!copy || !kEl || !tEl || !dEl) return;

  const slides = [
    { kicker: 'The Hottest Programming Hub', title: 'Code harder. Ship faster. Stay sharp.', dek: 'Tips & tricks for 13 languages, community Q&A, developer forums, and live tech news from the world’s top feeds.' },
    { kicker: 'Live Tech News', title: 'Never miss what ships.', dek: '15 live feeds across AI, dev, business, security and science — organized by topic and refreshed continuously.' },
    { kicker: 'Health & Medical', title: 'Stay informed. Stay well.', dek: 'Top health and medical news, grouped by topic from ScienceDaily, WHO, NPR, STAT and more.' },
    { kicker: 'Hospitality & Travel', title: 'Book. Stay. Explore.', dek: 'Top booking and hotel platforms — Booking.com, Airbnb, Marriott — plus live hospitality-industry news.' },
    { kicker: 'Jobs & Careers', title: 'Find your next role.', dek: 'Top global job boards, tech & startup roles, remote-first work, and the world’s biggest staffing firms.' },
    { kicker: 'Practice & Compete', title: 'Sharpen your edge.', dek: 'LeetCode, NeetCode, Codeforces and ICPC — crack interviews and climb the competitive-programming ranks.' }
  ];

  let idx = 0, timer = null;
  dotsEl.innerHTML = slides.map((s, i) =>
    `<button class="hero-dot${i === 0 ? ' active' : ''}" role="tab" aria-label="${esc(s.kicker)}" data-i="${i}"></button>`).join('');
  const dots = [...dotsEl.querySelectorAll('.hero-dot')];

  function show(i) {
    idx = (i + slides.length) % slides.length;
    const s = slides[idx];
    copy.classList.remove('swap'); void copy.offsetWidth; // restart the fade
    kEl.textContent = s.kicker; tEl.textContent = s.title; dEl.textContent = s.dek;
    copy.classList.add('swap');
    dots.forEach((d, n) => d.classList.toggle('active', n === idx));
  }
  function start() { stop(); timer = setInterval(() => show(idx + 1), 5000); }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  dotsEl.addEventListener('click', e => { const d = e.target.closest('.hero-dot'); if (!d) return; show(+d.dataset.i); start(); });
  const hero = document.getElementById('home-hero');
  if (hero) { hero.addEventListener('mouseenter', stop); hero.addEventListener('mouseleave', start); }
  start();
})();

// ---------- Global site search ----------
(function initSiteSearch() {
  const box = document.getElementById('site-search');
  const input = document.getElementById('site-search-input');
  const resEl = document.getElementById('site-search-results');
  const clearBtn = document.getElementById('site-search-clear');
  const kbd = document.getElementById('site-search-kbd');
  if (!box || !input || !resEl) return;

  let activeIdx = -1;   // highlighted row for keyboard nav (-1 = none)
  let lastQuery = '';

  const cache = {};
  async function jGet(url) {
    const c = cache[url];
    if (c && Date.now() - c.t < 5 * 60 * 1000) return c.d;
    try { const d = await api(url); cache[url] = { t: Date.now(), d }; return d; }
    catch (e) { return null; }
  }
  // Index the curated resource cards already in the DOM (Learn, Jobs, Home sections, Hospitality…).
  function resourceCards() {
    return [...document.querySelectorAll('a.card.clickable[href^="http"]')].map(a => ({
      title: (a.querySelector('h3') || {}).textContent || '',
      desc: (a.querySelector('p') || {}).textContent || '',
      href: a.getAttribute('href')
    }));
  }
  // Multi-term AND matching: every whitespace-separated term must appear.
  const terms = q => q.split(/\s+/).filter(Boolean);
  const matches = (ts, ...parts) => { const hay = parts.join(' ').toLowerCase(); return ts.every(t => hay.includes(t)); };
  // Escape text, then wrap query terms in <mark>.
  function hl(text, ts) {
    const safe = esc(text);
    if (!ts.length) return safe;
    const rx = new RegExp('(' + ts.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    return safe.replace(rx, '<mark class="ss-hl">$1</mark>');
  }
  const openHint = () => { if (kbd) kbd.textContent = document.activeElement === input ? 'esc' : '/'; };

  let timer = null;
  input.addEventListener('input', () => {
    clearBtn.classList.toggle('hidden', !input.value);
    clearTimeout(timer);
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { hide(); return; }
    // Instant skeleton feedback, debounced real query.
    resEl.classList.remove('hidden'); box.setAttribute('aria-expanded', 'true');
    if (q !== lastQuery) resEl.innerHTML = skeleton();
    timer = setTimeout(() => run(q), 220);
  });

  function skeleton() {
    return '<div class="ss-skel">' + Array.from({ length: 4 }, () =>
      '<div class="ss-skel-row"><div class="ss-skel-line lg"></div><div class="ss-skel-line sm"></div></div>').join('') + '</div>';
  }
  function hide() {
    resEl.classList.add('hidden'); resEl.innerHTML = '';
    box.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-activedescendant', '');
    activeIdx = -1; lastQuery = '';
  }
  function reset() { input.value = ''; clearBtn.classList.add('hidden'); hide(); }

  clearBtn.addEventListener('click', () => { reset(); input.focus(); });
  document.addEventListener('click', e => { if (!box.contains(e.target)) { resEl.classList.add('hidden'); box.setAttribute('aria-expanded', 'false'); } });
  input.addEventListener('focus', () => { openHint(); if (input.value.trim().length >= 2) run(input.value.trim().toLowerCase()); });
  input.addEventListener('blur', () => { if (kbd) kbd.textContent = '/'; });

  // "/" from anywhere (or ⌘K / Ctrl+K) focuses search; Escape clears/blurs.
  document.addEventListener('keydown', e => {
    const el = e.target, tag = (el.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || el.isContentEditable;
    if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
      e.preventDefault(); input.focus(); input.select();
    }
  });

  function items() { return [...resEl.querySelectorAll('.ss-item')]; }
  function setActive(list, idx) {
    list.forEach((el, i) => el.classList.toggle('active', i === idx));
    activeIdx = idx;
    if (idx >= 0 && list[idx]) {
      list[idx].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', list[idx].id);
    } else {
      input.setAttribute('aria-activedescendant', '');
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (input.value) reset(); else input.blur(); return; }
    const list = items();
    if (!list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(list, (activeIdx + 1) % list.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(list, (activeIdx - 1 + list.length) % list.length); }
    else if (e.key === 'Enter') {
      const target = activeIdx >= 0 ? list[activeIdx] : list[0];
      if (target) { e.preventDefault(); target.click(); }
    }
  });
  // Hover syncs the keyboard highlight so mouse + keys don't fight.
  resEl.addEventListener('mousemove', e => {
    const it = e.target.closest('.ss-item'); if (!it) return;
    const list = items(); const i = list.indexOf(it);
    if (i !== activeIdx) setActive(list, i);
  });

  async function run(q) {
    lastQuery = q;
    const ts = terms(q);
    const [news, health, hosp, qs, forums] = await Promise.all([
      jGet('/api/news'), jGet('/api/health-news'), jGet('/api/hospitality-news'), jGet('/api/questions'), jGet('/api/forums')
    ]);
    if (input.value.trim().toLowerCase() !== q) return; // superseded by a newer keystroke
    const feed = data => ((data && data.items) || []).filter(i => matches(ts, i.title, i.snippet || '')).slice(0, 5)
      .map(i => ({ title: i.title, sub: i.source, href: i.link, ext: true }));
    const groups = [
      { name: 'Resources', icon: '🔗', items: resourceCards().filter(r => matches(ts, r.title, r.desc)).slice(0, 6)
        .map(r => ({ title: r.title, sub: r.desc.slice(0, 70), href: r.href, ext: true })) },
      { name: 'Tech News', icon: '📡', items: feed(news) },
      { name: 'Health', icon: '🩺', items: feed(health) },
      { name: 'Hospitality', icon: '🏨', items: feed(hosp) },
      { name: 'Q&A', icon: '💬', items: (qs || []).filter(x => matches(ts, x.title, x.body)).slice(0, 5)
        .map(x => ({ title: x.title, sub: '▲ ' + x.votes + ' · ' + x.answers.length + ' answers', navTo: 'qa' })) },
      { name: 'Forums', icon: '🗣️', items: (forums || []).filter(t => matches(ts, t.title, t.category)).slice(0, 5)
        .map(t => ({ title: t.title, sub: t.category, navTo: 'forums' })) },
      { name: 'Languages', icon: '💻', items: (state.languages || []).filter(l => matches(ts, l.name, l.tagline, (l.usedFor || []).join(' '))).slice(0, 6)
        .map(l => ({ title: (l.icon || '') + ' ' + l.name, sub: l.tagline, navTo: 'languages' })) }
    ].filter(g => g.items.length);

    resEl.classList.remove('hidden'); box.setAttribute('aria-expanded', 'true');
    activeIdx = -1; input.setAttribute('aria-activedescendant', '');
    if (!groups.length) {
      resEl.innerHTML = `<div class="ss-empty"><div class="ss-empty-ico">🔍</div>No matches for “${esc(input.value.trim())}”.<div class="ss-empty-sub">Try a language, topic, or fewer words.</div></div>`;
      return;
    }
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    let idx = 0;
    resEl.innerHTML = groups.map(g => `
      <div class="ss-group">
        <div class="ss-group-head"><span>${g.icon} ${g.name}</span><span class="ss-count">${g.items.length}</span></div>
        ${g.items.map(it => {
          const id = 'ss-opt-' + (idx++);
          const attrs = it.ext
            ? `href="${esc(it.href)}" target="_blank" rel="noopener"`
            : `href="#${it.navTo}" data-nav="${it.navTo}"`;
          return `<a class="ss-item" id="${id}" role="option" ${attrs}>
            <span class="ss-title">${hl(it.title, ts)}</span>
            <span class="ss-sub">${hl(it.sub || '', ts)}</span>
            ${it.ext ? '<span class="ss-arrow" aria-hidden="true">↗</span>' : '<span class="ss-arrow" aria-hidden="true">→</span>'}
          </a>`;
        }).join('')}
      </div>`).join('') +
      `<div class="ss-foot">
         <span class="ss-foot-keys"><kbd>↑</kbd><kbd>↓</kbd> navigate&nbsp; <kbd>↵</kbd> open&nbsp; <kbd>esc</kbd> close</span>
         <span class="ss-foot-count">${total} result${total === 1 ? '' : 's'}</span>
       </div>`;
  }
  // Internal results use data-nav (handled by the global nav handler); close the panel after.
  resEl.addEventListener('click', e => { if (e.target.closest('[data-nav]')) reset(); });
})();
