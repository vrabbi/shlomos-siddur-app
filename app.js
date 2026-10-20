/* סידור הילולת רבי שלמה – offline PWA */
(() => {
'use strict';

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('siddur.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('siddur.' + k, JSON.stringify(v)); } catch (e) {} }
};
const ICON_NOTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 18.5a3 3 0 1 1-2-2.83V5l12-2v12.5a3 3 0 1 1-2-2.83V7.1l-8 1.34z"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5a2.7 2.7 0 0 0-1.9 1.9C2 8.9 2 12 2 12s0 3.1.4 4.8a2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9c.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8zM10 15.1V8.9l5.2 3.1z"/></svg>';

let DATA = null;
let BOOKS = {};
let observer = null;
let current = { book: null, id: null };

/* ---------- settings ---------- */
const root = document.documentElement;
function applyFont(px) {
  px = Math.max(16, Math.min(40, Math.round(px)));
  root.style.setProperty('--fs', px + 'px');
  $('#fs').value = px; store.set('fs', px);
}
function applyTheme(t) {
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  $$('#theme-seg button').forEach(b => b.classList.toggle('on', b.dataset.theme === t));
  store.set('theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#2a1428' : '#551b53');
  const btn = $('#btn-theme');
  btn.classList.toggle('is-dark', dark);
  btn.setAttribute('aria-label', dark ? 'מעבר למצב בהיר' : 'מעבר למצב כהה');
}
let wakeLock = null;
async function setWake(on) {
  store.set('wake', on);
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* ignore */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.get('wake', false)) setWake(true);
});

/* ---------- data shaping ---------- */
function flatSections(book) {
  // returns list of {id,title,level,group?,letter?,obj}
  const out = [];
  for (const s of book.sections) {
    if (s.letters) {
      out.push({ id: s.id, title: s.title, level: 1, group: s.group, obj: s });
      for (const l of s.letters) out.push({ id: l.id, title: l.title, level: 2, letter: true, parent: s, obj: l });
    } else if (s.subs) {
      out.push({ id: s.id, title: s.title, level: 1, obj: s });
      for (const x of s.subs) out.push({ id: x.id, title: x.title, level: 2, parent: s, obj: x });
    } else out.push({ id: s.id, title: s.title, level: 1, obj: s });
  }
  return out;
}

/* ---------- rendering text ---------- */
function runsHTML(runs, verse) {
  let html = '';
  let i = 0;
  while (i < runs.length) {
    const r = runs[i];
    if (r.blue) {
      // gather a contiguous blue phrase (song passage)
      let j = i, songs = [], inner = '';
      while (j < runs.length && (runs[j].blue || (runs[j].t.trim() === '' && j + 1 < runs.length && runs[j + 1].blue))) {
        const x = runs[j];
        if (x.songs) for (const s of x.songs) if (!songs.includes(s)) songs.push(s);
        inner += runHTML(x, verse); j++;
      }
      if (songs.length) {
        const label = songs.map(s => DATA.songs[s].title).join(', ');
        const lead = inner.match(/^\s*/)[0], trail = inner.match(/\s*$/)[0];
        html += lead + `<span class="song" data-songs="${songs.join(',')}" role="button" tabindex="0" aria-label="שיר: ${esc(label)}">${inner.trim()}</span>` +
          `<button class="note-btn" data-songs="${songs.join(',')}" aria-label="האזנה: ${esc(label)}">${ICON_NOTE}${songs.length > 1 ? songs.length : ''}</button>` + trail;
      } else html += `<span class="blue">${inner}</span>`;
      i = j; continue;
    }
    html += runHTML(r, verse); i++;
  }
  return html;
}
function runHTML(r, verse) {
  const t = esc(r.t);
  if (r.c === 'big') return `<span class="big">${t}</span>`;
  if (r.c === 'init') return `<span class="init">${t}</span>`;
  if (r.c === 'small') return `<span class="small">${t}</span>`;
  return t;
}
function parasHTML(paras, verses) {
  return paras.map(p => {
    if (verses) return `<p class="verse">${runsHTML(p.runs, true)}</p>`;
    return `<p class="txt${p.small ? ' small' : ''}">${runsHTML(p.runs)}</p>`;
  }).join('');
}
const shortTitle = t => t.replace(/^פרק\s+/, '');

function renderBook(bookId) {
  const book = BOOKS[bookId];
  let h = '';
  // quick nav
  h += `<div class="quick" id="quick">${quickChips(bookId)}</div>`;
  h += `<h1 class="book-title">${esc(book.title)}</h1>`;
  if (book.intro) h += `<p class="book-intro">${esc(book.intro)}</p>`;
  for (const s of book.sections) {
    if (s.letters) {
      h += `<section class="sec anchor" id="sec-${s.id}" data-title="${esc(s.title)}"><div class="grp-h">${esc(s.title)}</div>`;
      for (const l of s.letters)
        h += `<div class="anchor" id="sec-${l.id}" data-title="${esc(s.title)} · ${esc(l.title)}"><div class="letter-h"><b>${esc(l.title)}</b><span>${esc(s.group)}</span></div>${parasHTML(l.paras, true)}</div>`;
      h += `</section>`;
    } else if (s.subs) {
      h += `<section class="sec anchor" id="sec-${s.id}" data-title="${esc(s.title)}"><div class="sec-h">${esc(s.title)}</div>`;
      for (const x of s.subs)
        h += `<div class="anchor" id="sec-${x.id}" data-title="${esc(s.title)} · ${esc(x.title)}"><div class="sub-h">${esc(x.title)}</div>${parasHTML(x.paras)}</div>`;
      h += `</section>`;
    } else {
      h += `<section class="sec anchor" id="sec-${s.id}" data-title="${esc(s.title)}"><div class="sec-h">${esc(s.title)}</div>${parasHTML(s.paras)}</section>`;
    }
  }
  h += `<div class="end-mark">✦ ✦ ✦</div>`;
  return h;
}
function quickChips(bookId) {
  const book = BOOKS[bookId];
  let h = '';
  if (bookId === 'tehillim') {
    for (const s of book.sections) {
      if (s.letters) {
        h += `<span class="chip-sep">${esc(s.group)}:</span>`;
        for (const l of s.letters) h += `<button class="chip letter" data-go="${l.id}">${esc(l.title)}</button>`;
      } else h += `<button class="chip" data-go="${s.id}">${esc(shortTitle(s.title))}</button>`;
    }
  } else {
    const want = ['ashrei', 'hk', 'a-avot', 'a-kedusha', 'a-shma', 'a-retzeh', 'a-modim', 'a-sim', 'a-netzor', 'ks', 'aleinu', 'ky2'];
    const names = { 'a-avot': 'שמונה עשרה', 'a-netzor': 'אלהי נצור' };
    const all = flatSections(book);
    for (const id of want) {
      const f = all.find(x => x.id === id); if (!f) continue;
      h += `<button class="chip" data-go="${id}">${esc(names[id] || f.title)}</button>`;
    }
  }
  return h;
}

/* ---------- views ---------- */
function setBar(book, sec) {
  $('#bar-book').textContent = book;
  $('#bar-sec').textContent = sec || '';
}
function viewHome() {
  current = { book: null, id: null };
  $('#btn-menu').hidden = false; $('#btn-home').hidden = true;
  setBar('סידור הילולת רבי שלמה', '');
  const last = store.get('last', null);
  let lastLabel = '';
  if (last && BOOKS[last.book]) {
    const f = flatSections(BOOKS[last.book]).find(x => x.id === last.id);
    if (f) lastLabel = `${BOOKS[last.book].title} · ${f.parent ? f.parent.title + ' · ' : ''}${f.title}`;
  }
  $('#main').innerHTML = `
    <div class="hero">
      <div class="over">הַבּוֹחֵר בְּשִׁירֵי זִמְרָה</div>
      <h1>סידור הילולת<br>רבי שלמה קרליבך</h1>
      <div class="sub">תהלים · תפילת מנחה · שירי רבי שלמה</div>
      <svg class="ornament" viewBox="0 0 140 12" aria-hidden="true"><path d="M0 6 Q 8.75 0 17.5 6 T 35 6 T 52.5 6 T 70 6 T 87.5 6 T 105 6 T 122.5 6 T 140 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
    </div>
    <div class="cards">
      <a class="card" href="#/tehillim"><span class="ic">ת</span><span><h2>תהלים</h2><p>שבעה מזמורים · קי״ט באותיות שלמה ונשמה · הזכרת נשמות</p></span></a>
      <a class="card" href="#/mincha"><span class="ic">מ</span><span><h2>תפילת מנחה</h2><p>אשרי · קדיש · שמונה עשרה עם השירים · עלינו</p></span></a>
      <a class="card" href="#/songs"><span class="ic">♪</span><span><h2>השירים</h2><p>${Object.keys(DATA.songs).length} שירים של רבי שלמה, עם הסולם וקישור להאזנה</p></span></a>
      <a class="card" href="#/aliyot"><span class="ic">ע</span><span><h2>עליות לקבר</h2><p>סרטונים מהעלייה לקבר בשנים קודמות, מתשס״ח ועד היום</p></span></a>
    </div>
    ${lastLabel ? `<button class="resume" id="resume">להמשיך מהמקום האחרון: ${esc(lastLabel)}</button>` : ''}
    <div class="install" id="install" hidden></div>
    <p class="foot">הקטעים המסומנים בכחול הם שירי רבי שלמה – הקישו עליהם כדי לשמוע.<br>הסידור עובד גם בלי חיבור לאינטרנט.</p>`;
  if (lastLabel) $('#resume').onclick = () => { location.hash = `#/${last.book}/${last.id}`; };
  showInstallHint();
  window.scrollTo(0, 0);
}
function viewBook(bookId, secId) {
  const book = BOOKS[bookId];
  $('#btn-menu').hidden = false; $('#btn-home').hidden = false;
  if (current.book !== bookId) {
    $('#main').innerHTML = renderBook(bookId);
    current.book = bookId;
    observeSections();
  }
  setBar(book.title, '');
  if (secId) goTo(secId, false);
  else window.scrollTo(0, 0);
}
function viewSongs() {
  current = { book: null, id: null };
  $('#btn-menu').hidden = false; $('#btn-home').hidden = false;
  setBar('השירים', 'שירי רבי שלמה בתפילה');
  const where = songLocations();
  const order = Object.keys(where);
  for (const k of Object.keys(DATA.songs)) if (!order.includes(k)) order.push(k);
  $('#main').innerHTML = `<h1 class="book-title">שירי רבי שלמה</h1>
    <p class="book-intro">לפי סדר התפילה</p>
    <ul class="songs-list">${order.map(k => {
      const s = DATA.songs[k], w = where[k];
      return `<li><h3>${esc(s.title)} <span class="key">${esc(s.key)}</span></h3>
        ${w ? `<div class="where">${esc(w.label)}</div>` : ''}
        <p class="words">${esc(s.words)}</p>
        <div class="actions">${ytButton(s)}${w ? `<a class="btn ghost" href="#/${w.book}/${w.id}">למקום בתפילה</a>` : ''}</div></li>`;
    }).join('')}</ul>`;
  window.scrollTo(0, 0);
}
function viewAliyot() {
  current = { book: null, id: null };
  $('#btn-menu').hidden = false; $('#btn-home').hidden = false;
  setBar('עליות לקבר', 'משנים קודמות');
  const count = DATA.aliyot.reduce((n, y) => n + y.videos.length, 0);
  $('#main').innerHTML = `<h1 class="book-title">עליות לקבר</h1>
    <p class="book-intro">${count} סרטונים מהעלייה לקברו של רבי שלמה בהר המנוחות, לפי שנים</p>
    ${navigator.onLine ? '' : '<p class="offline">אין כרגע חיבור לאינטרנט – כדי לצפות בסרטונים צריך חיבור.</p>'}
    <ul class="songs-list aliyot">${DATA.aliyot.map(y => `<li>
      <h3>${esc(y.heb)} <span class="key">${y.greg}</span><span class="nth">היארצייט ה־${y.n}</span></h3>
      ${y.videos.map(v => `<a class="vid" href="https://youtu.be/${encodeURIComponent(v.yt)}${v.t ? `?t=${v.t}` : ''}" target="_blank" rel="noopener">${ICON_PLAY}
        <span><b>${esc(v.title)}</b><small><bdi>${esc(v.by)}</bdi>${v.min ? ` · ${v.min} דק׳` : ''}</small></span></a>`).join('')}
    </li>`).join('')}</ul>`;
  window.scrollTo(0, 0);
}
function songLocations() {
  const where = {};
  for (const book of DATA.books) for (const f of flatSections(book)) {
    const o = f.obj; if (!o.paras) continue;
    for (const p of o.paras) for (const r of p.runs) for (const s of (r.songs || []))
      if (!where[s]) where[s] = { book: book.id, id: f.id, label: `${book.title} · ${f.parent ? f.parent.title + ' · ' : ''}${f.title}` };
  }
  return where;
}

/* ---------- navigation within a book ---------- */
function goTo(id, smooth = true) {
  const el = document.getElementById('sec-' + id);
  if (!el) return;
  const quick = $('#quick');
  const off = $('#bar').offsetHeight + (quick ? quick.offsetHeight : 0) + 6;
  const y = el.getBoundingClientRect().top + window.scrollY - off;
  window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  markCurrent(id, el.dataset.title);
}
function markCurrent(id, title) {
  current.id = id;
  $('#bar-sec').textContent = title || '';
  store.set('last', { book: current.book, id });
  const q = $('#quick');
  if (q) {
    // highlight the chip of this section or its parent
    const book = BOOKS[current.book];
    const f = flatSections(book).find(x => x.id === id);
    let chipId = id;
    if (!q.querySelector(`[data-go="${chipId}"]`) && f && f.parent) {
      // amida: highlight nearest preceding chip
      const all = flatSections(book).map(x => x.id);
      const chips = $$('.chip', q).map(c => c.dataset.go);
      const idx = all.indexOf(id);
      chipId = chips.filter(c => all.indexOf(c) <= idx).pop() || chips[0];
    }
    $$('.chip', q).forEach(c => c.classList.toggle('on', c.dataset.go === chipId));
    const on = q.querySelector('.chip.on');
    if (on) {
      const qr = q.getBoundingClientRect(), cr = on.getBoundingClientRect();
      if (cr.left < qr.left + 10 || cr.right > qr.right - 10) q.scrollBy({ left: cr.left - qr.left - qr.width / 2 + cr.width / 2, behavior: 'smooth' });
    }
  }
}
function observeSections() {
  if (observer) observer.disconnect();
  const seen = new Map();
  observer = new IntersectionObserver(entries => {
    for (const e of entries) seen.set(e.target, e.isIntersecting);
    // pick the last anchor whose top is above the reading line
    const line = $('#bar').offsetHeight + ($('#quick') ? $('#quick').offsetHeight : 0) + 30;
    let best = null;
    for (const el of $$('.anchor')) {
      const top = el.getBoundingClientRect().top;
      if (top - line <= 0) best = el; else break;
    }
    if (!best) best = $('.anchor');
    if (best) {
      const id = best.id.slice(4);
      if (id !== current.id) markCurrent(id, best.dataset.title);
    }
  }, { rootMargin: '-100px 0px -60% 0px', threshold: [0, 1] });
  $$('.anchor').forEach(el => observer.observe(el));
}

/* ---------- drawer (table of contents) ---------- */
function openDrawer() {
  const books = current.book ? [BOOKS[current.book]] : DATA.books;
  let h = '<div class="toc">';
  books.forEach((book, bi) => {
    if (bi) h += '<hr>';
    h += `<div class="grp">${esc(book.title)}</div>`;
    for (const s of book.sections) {
      if (s.letters) {
        h += `<a href="#/${book.id}/${s.id}" class="${current.id === s.id ? 'on' : ''}">${esc(s.title)}</a><div class="letters">` +
          s.letters.map(l => `<a href="#/${book.id}/${l.id}" class="${current.id === l.id ? 'on' : ''}" aria-label="${esc(s.group)} ${esc(l.title)}">${esc(l.title)}</a>`).join('') + '</div>';
      } else if (s.subs) {
        h += `<a href="#/${book.id}/${s.subs[0].id}">${esc(s.title)}</a>` +
          s.subs.map(x => `<a class="lvl2 ${current.id === x.id ? 'on' : ''}" href="#/${book.id}/${x.id}">${esc(x.title)}</a>`).join('');
      } else h += `<a href="#/${book.id}/${s.id}" class="${current.id === s.id ? 'on' : ''}">${esc(s.title)}</a>`;
    }
  });
  h += '<hr><a href="#/songs">♪ כל השירים</a><a href="#/aliyot">עליות לקבר משנים קודמות</a><a href="#/">מסך הבית</a></div>';
  $('#drawer-body').innerHTML = h;
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  const on = $('#drawer-body a.on'); if (on) on.scrollIntoView({ block: 'center' });
}
function closeAll() {
  $('#drawer').hidden = true; $('#settings').hidden = true; $('#songsheet').hidden = true; $('#scrim').hidden = true;
}

/* ---------- songs sheet ---------- */
function ytButton(s) {
  return `<a class="btn yt" href="https://youtu.be/${encodeURIComponent(s.yt)}" target="_blank" rel="noopener">${ICON_PLAY}האזנה ביוטיוב</a>`;
}
function openSongs(ids) {
  const off = !navigator.onLine;
  $('#songsheet').innerHTML = `<div class="sheet-grip"></div>` + ids.map(k => {
    const s = DATA.songs[k];
    return `<div class="song-card"><h4>${esc(s.title)} <span class="key">${esc(s.key)}</span></h4>
      <p class="words">${esc(s.words)}</p>${off ? '<p class="offline">אין כרגע חיבור לאינטרנט – כדי לשמוע את השיר צריך חיבור.</p>' : ''}
      <div class="actions">${ytButton(s)}</div></div>`;
  }).join('') + `<button class="close-wide" data-close>סגירה</button>`;
  $('#songsheet').hidden = false; $('#scrim').hidden = false;
}

/* ---------- install hint ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; showInstallHint(); });
function showInstallHint() {
  const box = $('#install'); if (!box) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) { box.hidden = true; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (deferredPrompt) {
    box.innerHTML = 'אפשר להתקין את הסידור כאפליקציה בטלפון, והוא יעבוד גם בלי אינטרנט.<br><button id="do-install">התקנה</button>';
    box.hidden = false;
    $('#do-install').onclick = async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; box.hidden = true; };
  } else if (ios) {
    box.innerHTML = 'להתקנה באייפון: בספארי הקישו על כפתור השיתוף <b>⎋</b> ובחרו <b>„הוסף למסך הבית”</b>. אחרי ההתקנה הסידור עובד גם בלי אינטרנט.';
    box.hidden = false;
  }
}

function toast(msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- router ---------- */
function route() {
  closeAll();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return viewHome();
  if (parts[0] === 'songs') return viewSongs();
  if (parts[0] === 'aliyot') return viewAliyot();
  if (BOOKS[parts[0]]) return viewBook(parts[0], parts[1]);
  viewHome();
}

/* ---------- events ---------- */
function bind() {
  $('#btn-menu').onclick = openDrawer;
  $('#btn-home').onclick = () => { location.hash = '#/'; };
  $('#drawer-close').onclick = closeAll;
  $('#scrim').onclick = closeAll;
  $('#btn-settings').onclick = () => { $('#settings').hidden = false; $('#scrim').hidden = false; };
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-close]'); if (c) { closeAll(); return; }
    const go = e.target.closest('[data-go]');
    if (go) { goTo(go.dataset.go); history.replaceState(null, '', `#/${current.book}/${go.dataset.go}`); return; }
    const s = e.target.closest('[data-songs]');
    if (s) { openSongs(s.dataset.songs.split(',')); return; }
    const a = e.target.closest('#drawer a');
    if (a) {
      // same-book links: navigate without full re-render
      const [b, id] = a.getAttribute('href').replace('#/', '').split('/');
      if (b === current.book && id) { e.preventDefault(); closeAll(); goTo(id, false); history.replaceState(null, '', `#/${b}/${id}`); }
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAll();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.song')) { e.preventDefault(); openSongs(e.target.dataset.songs.split(',')); }
  });
  $('#fs').oninput = e => applyFont(+e.target.value);
  $('#fs-down').onclick = () => applyFont(+$('#fs').value - 1);
  $('#fs-up').onclick = () => applyFont(+$('#fs').value + 1);
  $$('#theme-seg button').forEach(b => b.onclick = () => applyTheme(b.dataset.theme));
  $('#btn-theme').onclick = e => applyTheme(e.currentTarget.classList.contains('is-dark') ? 'light' : 'dark');
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(store.get('theme', 'auto')));
  if (!('wakeLock' in navigator)) $('#wake-row').hidden = true;
  $('#wake').checked = store.get('wake', false);
  $('#wake').onchange = e => setWake(e.target.checked);
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => toast('יש חיבור לאינטרנט'));
  window.addEventListener('offline', () => toast('אין חיבור – הסידור ממשיך לעבוד, השירים יחכו לחיבור'));
}

/* ---------- boot ---------- */
applyFont(store.get('fs', Math.round(Math.min(24, Math.max(19, window.innerWidth / 19)))));
applyTheme(store.get('theme', 'auto'));
fetch('content.json').then(r => r.json()).then(d => {
  DATA = d; for (const b of d.books) BOOKS[b.id] = b;
  bind(); route();
  if (store.get('wake', false)) setWake(true);
}).catch(() => { $('#main').innerHTML = '<p class="foot">לא הצלחנו לטעון את הסידור. נסו לרענן.</p>'; });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && hadController) toast('גרסה חדשה של הסידור הותקנה – היא תיטען בפתיחה הבאה', 4500);
          if (nw.state === 'activated' && !hadController) toast('הסידור נשמר במכשיר ויעבוד גם בלי אינטרנט', 4000);
        });
      });
    }).catch(() => {});
  });
}
})();
