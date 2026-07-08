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

// ---------- Navigation ----------
function nav(view) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  window.scrollTo({ top: 0 });
  if (view === 'news' && !state.newsLoaded) loadNews();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-nav]');
  if (t) { e.preventDefault(); nav(t.dataset.nav); }
});

const state = { languages: [], questions: [], news: [], newsLoaded: false, newsFilter: '', adPkg: null };

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

// ---------- Q&A ----------
async function loadQuestions(q = '') {
  state.questions = await api('/api/questions' + (q ? '?q=' + encodeURIComponent(q) : ''));
  $('#stat-questions').textContent = state.questions.length;
  $('#qa-list').innerHTML = state.questions.map(x => `
    <div class="card q-item">
      <h3><span class="votes">▲ ${x.votes}</span>${esc(x.title)}</h3>
      <p class="muted">${esc(x.body)}</p>
      <div class="meta">
        ${x.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        <span>by ${esc(x.author)} · ${timeAgo(x.createdAt)} · ${x.answers.length} answer${x.answers.length===1?'':'s'}</span>
        <button class="btn btn-ghost btn-sm" onclick="voteQ('${x.id}')">▲ Upvote</button>
      </div>
      ${x.answers.map(a => `
        <div class="answer ${a.accepted ? 'accepted' : ''}">
          ${a.accepted ? '<span class="accepted-badge">✓ ACCEPTED</span> ' : ''}
          ${esc(a.body).replace(/`([^`]+)`/g, '<code>$1</code>')}
          <div class="meta"><span>▲ ${a.votes} · ${esc(a.author)} · ${timeAgo(a.createdAt)}</span></div>
        </div>`).join('')}
      <div style="margin-top:12px; display:flex; gap:8px">
        <input class="input" style="margin:0" id="ans-${x.id}" placeholder="Write an answer…" />
        <button class="btn btn-primary btn-sm" onclick="postAnswer('${x.id}')">Answer</button>
      </div>
    </div>`).join('') || '<p class="muted">No questions match. Ask the first one!</p>';
}
window.voteQ = async id => { await api(`/api/questions/${id}/vote`, { method: 'POST', body: '{}' }); loadQuestions($('#qa-search').value); };
window.postAnswer = async id => {
  const inp = $('#ans-' + id);
  if (!inp.value.trim()) return;
  await api(`/api/questions/${id}/answers`, { method: 'POST', body: JSON.stringify({ body: inp.value, author: 'you' }) });
  loadQuestions($('#qa-search').value);
};
$('#btn-ask').onclick = () => $('#qa-form').classList.toggle('hidden');
$('#qa-submit').onclick = async () => {
  const title = $('#qa-title').value.trim(), body = $('#qa-body').value.trim();
  if (!title || !body) return alert('Title and body are required.');
  await api('/api/questions', { method: 'POST', body: JSON.stringify({ title, body, tags: $('#qa-tags').value, author: $('#qa-author').value || 'anonymous' }) });
  $('#qa-form').classList.add('hidden');
  ['#qa-title','#qa-body','#qa-tags'].forEach(s => $(s).value = '');
  loadQuestions();
};
let qaTimer;
$('#qa-search').oninput = e => { clearTimeout(qaTimer); qaTimer = setTimeout(() => loadQuestions(e.target.value), 300); };

// ---------- Forums ----------
async function loadForums(cat = '') {
  const list = await api('/api/forums' + (cat ? '?category=' + encodeURIComponent(cat) : ''));
  $('#stat-threads').textContent = list.length;
  $('#thread-view').classList.add('hidden');
  $('#forum-list').classList.remove('hidden');
  $('#forum-list').innerHTML = list.map(t => `
    <div class="card clickable q-item" onclick="openThread('${t.id}')">
      <h3>${esc(t.title)}</h3>
      <div class="meta">
        <span class="tag">${esc(t.category)}</span>
        <span>by ${esc(t.author)} · ${timeAgo(t.createdAt)} · 💬 ${t.replies} replies · 👁 ${t.views} views</span>
      </div>
    </div>`).join('') || '<p class="muted">No threads yet in this category.</p>';
}
window.openThread = async id => {
  const t = await api('/api/forums/' + id);
  $('#forum-list').classList.add('hidden');
  const v = $('#thread-view');
  v.classList.remove('hidden');
  v.innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="loadForums()">← Back to forums</button>
    <div class="card" style="margin-top:12px">
      <h2>${esc(t.title)}</h2>
      <div class="meta"><span class="tag">${esc(t.category)}</span><span>👁 ${t.views} views</span></div>
      ${t.posts.map(p => `
        <div class="answer">
          ${esc(p.body)}
          <div class="meta"><span>${esc(p.author)} · ${timeAgo(p.createdAt)}</span></div>
        </div>`).join('')}
      <div style="margin-top:14px; display:flex; gap:8px">
        <input class="input" style="margin:0" id="reply-inp" placeholder="Write a reply…" />
        <button class="btn btn-primary btn-sm" onclick="postReply('${t.id}')">Reply</button>
      </div>
    </div>`;
};
window.postReply = async id => {
  const inp = $('#reply-inp');
  if (!inp.value.trim()) return;
  await api(`/api/forums/${id}/posts`, { method: 'POST', body: JSON.stringify({ body: inp.value, author: 'you' }) });
  openThread(id);
};
$('#btn-new-thread').onclick = () => $('#thread-form').classList.toggle('hidden');
$('#th-submit').onclick = async () => {
  const title = $('#th-title').value.trim(), body = $('#th-body').value.trim();
  if (!title || !body) return alert('Title and body are required.');
  await api('/api/forums', { method: 'POST', body: JSON.stringify({ title, body, category: $('#th-cat').value, author: $('#th-author').value || 'anonymous' }) });
  $('#thread-form').classList.add('hidden');
  ['#th-title','#th-body'].forEach(s => $(s).value = '');
  loadForums();
};
$('#forum-cats').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#forum-cats .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  loadForums(c.dataset.cat);
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
    $('#news-sources').innerHTML = `<button class="chip active" data-src="">All</button>` +
      sources.map(s => `<button class="chip" data-src="${esc(s)}">${esc(s)}</button>`).join('');
    renderNews();
    renderHomeNews(data.items);
    if (data.failedFeeds?.length) $('#news-meta').textContent += ` · unavailable: ${data.failedFeeds.join(', ')}`;
  } catch (e) {
    $('#news-list').innerHTML = `<p class="muted">Couldn't load news feeds (${esc(e.message)}). Check your internet connection and reload.</p>`;
  }
}
function renderHomeNews(items) {
  if (!items.length) return;
  // Ticker: top 3 headlines
  $('#ticker').innerHTML = items.slice(0, 3)
    .map(i => `<span>■ ${esc(i.title)}</span>`).join(' ');
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
function renderNews() {
  const items = state.newsFilter ? state.news.filter(i => i.source === state.newsFilter) : state.news;
  $('#news-list').innerHTML = items.slice(0, 60).map(newsCard).join('') || '<p class="muted">No stories.</p>';
}
$('#news-sources').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  $$('#news-sources .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  state.newsFilter = c.dataset.src;
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
  state.adPkg = id;
  const p = state.pkgs.find(x => x.id === id);
  $('#ad-form').classList.remove('hidden');
  $('#ad-form-title').textContent = `Book: ${p.name} — $${p.price}${p.period}`;
  $('#ad-result').textContent = '';
  $('#ad-form').scrollIntoView({ behavior: 'smooth' });
};
$('#ad-submit').onclick = async () => {
  const company = $('#ad-company').value.trim(), email = $('#ad-email').value.trim();
  if (!state.adPkg) return alert('Pick a package first.');
  if (!company || !email) return alert('Company and email are required.');
  try {
    const r = await api('/api/ads/inquiries', { method: 'POST', body: JSON.stringify({ packageId: state.adPkg, company, email, message: $('#ad-message').value }) });
    $('#ad-result').textContent = '✅ ' + r.note;
    ['#ad-company','#ad-email','#ad-message'].forEach(s => $(s).value = '');
  } catch (e) { $('#ad-result').textContent = '❌ ' + e.message; }
};

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

// ---------- Init ----------
(async function init() {
  await Promise.all([loadLanguages(), loadQuestions(), loadForums(), loadAds()]);
  loadTrending();
  loadNews(); // background, also fills home preview
})();
