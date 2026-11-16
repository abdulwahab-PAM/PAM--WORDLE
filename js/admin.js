/* ─────────────────────────────────────────────────────────────────────────
   PAM Word Challenge — admin console
   ───────────────────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const U = API.util;
  const t = (k, v) => I18N.t(k, v);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = n => Number(n || 0).toLocaleString('en-US');

  const ICON = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
    words: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="6" height="10" rx="1.5"/><rect x="9" y="7" width="6" height="10" rx="1.5"/><rect x="16" y="7" width="6" height="10" rx="1.5"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/></svg>'
  };

  const FIELDS = [
    { g: 'a_g_branding', items: [
      { k: 'event_title_ar', type: 'text', dir: 'rtl' },
      { k: 'event_title_en', type: 'text', dir: 'ltr' },
      { k: 'season_name', type: 'text' }
    ] },
    { g: 'a_g_gameplay', items: [
      { k: 'max_attempts', type: 'number', min: 3, max: 10 },
      { k: 'plays_per_day', type: 'number', min: 0, max: 100 },
      { k: 'word_lang_mode', type: 'select', options: ['ui', 'en', 'ar'] },
      { k: 'require_known_words', type: 'bool' }
    ] },
    { g: 'a_g_hints', items: [
      { k: 'hints_enabled', type: 'bool' },
      { k: 'hint_penalty', type: 'number', min: 0, max: 1000, step: 10 }
    ] },
    { g: 'a_g_kiosk', items: [
      { k: 'show_leaderboard', type: 'bool' },
      { k: 'leaderboard_size', type: 'number', min: 3, max: 50 },
      { k: 'sound_enabled', type: 'bool' },
      { k: 'idle_timeout_seconds', type: 'number', min: 15, max: 3600, step: 5 },
      { k: 'result_screen_seconds', type: 'number', min: 5, max: 300 }
    ] },
    { g: 'a_g_players', items: [
      { k: 'id_min_length', type: 'number', min: 1, max: 20 },
      { k: 'id_max_length', type: 'number', min: 1, max: 20 },
      { k: 'timezone', type: 'text', dir: 'ltr' }
    ] }
  ];

  const A = {
    lang: (() => { try { return localStorage.getItem('pamwc_admin_lang') || cfg.DEFAULT_LANG || 'ar'; } catch (e) { return 'ar'; } })(),
    page: 'dashboard',
    user: null,
    settings: { ...API.DEFAULT_SETTINGS },
    stats: null, dashTop: [], dashRecent: [],
    words: [], games: [], board: [], categories: [], dict: { en: 0, ar: 0 },
    wf: { q: '', lang: 'all', status: 'all', cat: 'all' },
    rf: { q: '', status: 'all', range: 'season' },
    period: 'season',
    parsed: [],
    editing: null, editingCat: null, importing: false,
    dirty: false
  };

  /* ═══════════════════════ helpers ═══════════════════════ */
  const tz = () => A.settings.timezone || 'Asia/Kuwait';
  const dayOf = iso => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz() }); } catch (e) { return String(iso).slice(0, 10); } };
  const locale = () => (A.lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB');

  function fmtDate(iso, withTime = true) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat(locale(), withTime
        ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz() }
        : { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz() }).format(new Date(iso));
    } catch (e) { return new Date(iso).toLocaleString(); }
  }
  const fmtDur = ms => {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const miniWord = (w, lang, cls = '') =>
    `<span class="mini-word ${cls}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">${U.chars(w).map(c => `<span>${esc(lang === 'en' ? c.toUpperCase() : c)}</span>`).join('')}</span>`;
  const langBadge = l => `<span class="badge ${l}">${l === 'ar' ? 'عربي' : 'EN'}</span>`;

  function toast(msg, type = 'info', ms = 2600) {
    const wrap = $('#toasts');
    const n = document.createElement('div');
    n.className = 'toast ' + type;
    n.textContent = msg;
    wrap.appendChild(n);
    requestAnimationFrame(() => n.classList.add('show'));
    setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, ms);
  }

  function confirmBox(title, text, okLabel) {
    return new Promise(resolve => {
      const d = $('#dlg-confirm');
      $('#dc-title').textContent = title;
      $('#dc-text').textContent = text;
      $('#dc-ok').textContent = okLabel || t('a_delete');
      const done = v => { d.close(); $('#dc-ok').onclick = $('#dc-cancel').onclick = null; d.onclose = null; resolve(v); };
      $('#dc-ok').onclick = () => done(true);
      $('#dc-cancel').onclick = () => done(false);
      d.onclose = () => resolve(false);
      d.showModal();
    });
  }

  function errText(e) {
    const c = e && e.code;
    if (c === 'NETWORK') return t('a_err_network');
    if (c === 'DUPLICATE') return t('a_err_duplicate');
    if (c === 'INVALID_WORD_EN' || c === 'INVALID_WORD_AR') return t('a_err_invalid_word');
    if (c === 'STORAGE_FULL') return t('a_err_storage_full');
    return t('a_err_generic');
  }
  function handleErr(e) {
    console.error(e);
    if (e && e.code === 'FORBIDDEN') { toast(t('a_session_expired'), 'error'); logout(); return; }
    toast(errText(e), 'error');
  }

  function downloadCSV(name, header, rows) {
    const cell = v => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s;                // CSV-injection guard
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function setSeg(id, value) { $$(`#${id} [data-v]`).forEach(b => b.classList.toggle('active', b.dataset.v === value)); }

  /* ═══════════════════════ language ═══════════════════════ */
  function setLang(l) {
    A.lang = l === 'en' ? 'en' : 'ar';
    try { localStorage.setItem('pamwc_admin_lang', A.lang); } catch (e) { /* ignore */ }
    I18N.set(A.lang);
    $$('[data-lang-toggle]').forEach(b => { b.textContent = t('lang_switch'); });
    if (!$('#shell').hidden) { setTitle(); renderCurrent(); }
  }

  /* ═══════════════════════ auth ═══════════════════════ */
  function showLogin() {
    $('#shell').hidden = true;
    $('#login').hidden = false;
    $('#l-demo').hidden = API.mode !== 'demo';
    setTimeout(() => $('#l-email').focus(), 50);
  }

  async function onLogin(e) {
    e.preventDefault();
    const btn = $('#l-submit'), alert = $('#l-alert');
    alert.hidden = true;
    btn.classList.add('loading');
    try {
      A.user = await API.auth.signIn($('#l-email').value.trim(), $('#l-pass').value);
      $('#l-pass').value = '';
      await enter();
    } catch (err) {
      alert.textContent = t(err.code === 'NOT_ADMIN' ? 'a_not_admin' : err.code === 'NETWORK' ? 'a_err_network' : 'a_bad_login');
      alert.hidden = false;
    } finally {
      btn.classList.remove('loading');
    }
  }

  async function enter() {
    $('#login').hidden = true;
    $('#shell').hidden = false;
    $('#demo-banner').hidden = API.mode !== 'demo';
    $('#me-email').textContent = (A.user && A.user.email) || '';
    try { A.settings = { ...A.settings, ...(await API.admin.getSettings()) }; } catch (e) { handleErr(e); }
    const hash = location.hash.slice(1);
    go(LOADERS[hash] ? hash : 'dashboard');
  }

  async function logout() {
    try { await API.auth.signOut(); } catch (e) { /* ignore */ }
    A.user = null;
    history.replaceState(null, '', location.pathname);
    showLogin();
  }

  /* ═══════════════════════ navigation ═══════════════════════ */
  const LOADERS = {
    dashboard: loadDashboard,
    words: loadWords,
    categories: loadCategories,
    dictionary: loadDictionary,
    results: loadResults,
    champions: loadChampions,
    settings: loadSettings
  };
  const RENDERERS = {
    dashboard: renderDashboard,
    words: () => { fillCatSelects(); renderWords(); renderPreview(); },
    categories: renderCategories,
    dictionary: renderDictionary,
    results: renderResults,
    champions: renderChampions,
    settings: renderSettings
  };

  function setTitle() {
    $('#page-title').textContent = t('a_nav_' + A.page);
    $('#page-sub').textContent = t('a_sub_' + A.page);
    document.title = `${t('a_nav_' + A.page)} · ${t('a_title')}`;
  }

  async function go(page) {
    if (A.page === 'settings' && page !== 'settings' && A.dirty) {
      if (await confirmBox(t('a_unsaved'), '', t('a_save'))) await saveSettings();
      A.dirty = false;
      $('#s-bar').classList.remove('show');
    }
    A.page = page;
    $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
    $$('.page').forEach(p => { p.hidden = p.dataset.page !== page; });
    setTitle();
    try { history.replaceState(null, '', '#' + page); } catch (e) { /* ignore */ }
    try { await LOADERS[page](); } catch (e) { handleErr(e); }
  }
  const renderCurrent = () => { const r = RENDERERS[A.page]; if (r) r(); };

  /* ═══════════════════════ dashboard ═══════════════════════ */
  async function loadDashboard() {
    const [st, top, recent] = await Promise.all([
      API.admin.stats(), API.admin.leaderboard('season', 5), API.admin.listGames(8)
    ]);
    A.stats = st; A.dashTop = top; A.dashRecent = recent;
    renderDashboard();
  }

  function renderDashboard() {
    const st = A.stats;
    if (!st) return;
    const rate = st.games_season ? Math.round(st.wins_season * 100 / st.games_season) : 0;
    const kpis = [
      [ICON.users, nf(st.players_season), t('a_kpi_players'), t('a_kpi_players_sub', { n: nf(st.players) })],
      [ICON.play, nf(st.games_today), t('a_kpi_today'), ''],
      [ICON.target, rate + '%', t('a_kpi_rate'), `${nf(st.wins_season)} / ${nf(st.games_season)}`],
      [ICON.star, nf(st.avg_score), t('a_kpi_avg'), t('a_kpi_avg_sub', { n: st.avg_attempts || 0 })],
      [ICON.words, nf((st.words_en || 0) + (st.words_ar || 0)), t('a_kpi_words'), `EN ${nf(st.words_en)} · عربي ${nf(st.words_ar)}`]
    ];
    $('#kpis').innerHTML = kpis.map(([ic, v, l, s]) =>
      `<div class="card kpi"><div class="ico">${ic}</div><b>${esc(v)}</b><span>${esc(l)}</span>${s ? `<small>${esc(s)}</small>` : ''}</div>`).join('');

    // 14-day chart
    const map = new Map((st.daily || []).map(d => [String(d.day).slice(0, 10), d]));
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const key = dayOf(d.toISOString());
      days.push({ key, date: d, ...(map.get(key) || { games: 0, wins: 0 }) });
    }
    const max = Math.max(1, ...days.map(d => d.games));
    const today = dayOf(new Date().toISOString());
    $('#chart').innerHTML = days.map((d, i) => {
      const hgt = d.games ? Math.max(4, d.games / max * 100) : 2;
      const w = d.games ? d.wins / d.games * 100 : 0;
      const lbl = new Intl.DateTimeFormat(locale(), { day: 'numeric', timeZone: tz() }).format(d.date);
      const wd = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: tz() }).format(d.date);
      return `<div class="bar-col${d.key === today ? ' today' : ''}" title="${esc(d.key)} — ${d.games} / ${d.wins}">
        <span class="v">${d.games || ''}</span>
        <div class="track"><div class="bar" style="height:${hgt}%;animation-delay:${i * 30}ms"><i style="height:${w}%"></i></div></div>
        <small>${esc(wd)}</small><small>${esc(lbl)}</small></div>`;
    }).join('');

    $('#dash-top').innerHTML = A.dashTop.length
      ? A.dashTop.map(r => `<li><span class="rk">${r.rank}</span><div><strong>${esc(r.full_name)}</strong><small dir="ltr">${esc(r.id_display)}</small></div><b>${nf(r.total_score)}</b></li>`).join('')
      : `<li class="empty">${esc(t('a_no_rows'))}</li>`;

    $('#dash-recent').innerHTML = gamesTable(A.dashRecent, false);
  }

  /* ═══════════════════════ words ═══════════════════════ */
  async function loadWords() {
    const [words, cats] = await Promise.all([API.admin.listWords(), API.admin.listCategories()]);
    A.words = words; A.categories = cats;
    fillCatSelects();
    renderWords();
  }

  /* ── category helpers ── */
  const catById = id => A.categories.find(c => c.id === id);
  const catName = c => (c ? (A.lang === 'ar' ? c.name_ar : c.name_en) : '');
  function catOptions(selected, mode) {
    const head = mode === 'filter'
      ? `<option value="all">${esc(t('a_all_categories'))}</option><option value="none">${esc(t('a_no_category'))}</option>`
      : `<option value="">${esc(t('a_no_category'))}</option>`;
    return head + A.categories.map(c =>
      `<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}>${esc(catName(c))}</option>`).join('');
  }
  function fillCatSelects() {
    if (A.wf.cat !== 'all' && A.wf.cat !== 'none' && !catById(Number(A.wf.cat))) A.wf.cat = 'all';
    $('#w-cat').innerHTML = catOptions(A.wf.cat, 'filter');
    $('#w-cat').value = A.wf.cat;
    const keep = $('#w-bulk-cat').value;
    $('#w-bulk-cat').innerHTML = catOptions(keep, 'pick');
  }

  function filteredWords() {
    const f = A.wf, raw = f.q.trim().toLowerCase(), q = U.normalize(f.q);
    return A.words.filter(w =>
      (f.lang === 'all' || w.lang === f.lang) &&
      (f.status === 'all' || (f.status === 'active') === !!w.active) &&
      (f.cat === 'all' || (f.cat === 'none' ? !w.category_id : String(w.category_id) === String(f.cat))) &&
      (!raw || w.word.includes(q) || (w.hint_en || '').toLowerCase().includes(raw) || (w.hint_ar || '').includes(raw)));
  }

  function renderWords() {
    const rows = filteredWords();
    const head = `<thead><tr>
      <th>${esc(t('a_col_word'))}</th><th>${esc(t('a_col_lang'))}</th><th>${esc(t('a_col_category'))}</th><th>${esc(t('a_col_len'))}</th>
      <th>${esc(t('a_col_hint'))}</th><th>${esc(t('a_col_played'))}</th><th>${esc(t('a_col_active'))}</th><th></th></tr></thead>`;
    const body = rows.length ? rows.map(w => `<tr class="${w.active ? '' : 'inactive'}" data-id="${w.id}">
      <td>${miniWord(w.word, w.lang)}</td>
      <td>${langBadge(w.lang)}</td>
      <td>${catById(w.category_id) ? `<span class="cat-pill">${esc(catName(catById(w.category_id)))}</span>` : `<span class="muted-pill">—</span>`}</td>
      <td class="num">${U.chars(w.word).length}</td>
      <td class="hint-cell"><div dir="ltr">${esc(w.hint_en || '—')}</div><div dir="rtl">${esc(w.hint_ar || '')}</div></td>
      <td class="num">${nf(w.plays)}</td>
      <td><label class="switch"><input type="checkbox" data-act="toggle" ${w.active ? 'checked' : ''}><span></span></label></td>
      <td class="acts">
        <button class="icon-act" type="button" data-act="edit" title="${esc(t('a_edit_word'))}">${ICON.edit}</button>
        <button class="icon-act del" type="button" data-act="delete" title="${esc(t('a_delete'))}">${ICON.del}</button>
      </td></tr>`).join('')
      : `<tr class="empty-row"><td colspan="8">${esc(t('a_no_rows'))}</td></tr>`;
    $('#w-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('#w-count').textContent = t('a_words_count', { n: nf(rows.length), t: nf(A.words.length) });
  }

  async function onWordsTable(e) {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    const w = A.words.find(x => x.id === id);
    if (!w) return;
    const act = e.target.closest('[data-act]');
    if (!act) return;

    if (act.dataset.act === 'toggle' && e.type === 'change') {
      const val = act.checked;
      w.active = val; tr.classList.toggle('inactive', !val);
      try { await API.admin.updateWord(id, { active: val }); toast(t('a_saved'), 'success', 1400); }
      catch (err) { w.active = !val; act.checked = !val; tr.classList.toggle('inactive', val); handleErr(err); }
    } else if (act.dataset.act === 'edit' && e.type === 'click') {
      openEdit(w);
    } else if (act.dataset.act === 'delete' && e.type === 'click') {
      const disp = w.lang === 'en' ? w.word.toUpperCase() : w.word;
      if (!(await confirmBox(t('a_delete'), t('a_confirm_delete_word', { w: disp })))) return;
      try { await API.admin.deleteWord(id); A.words = A.words.filter(x => x.id !== id); renderWords(); toast(t('a_deleted'), 'success'); }
      catch (err) { handleErr(err); }
    }
  }

  function openEdit(w) {
    A.editing = w;
    $('#e-word').value = w.word;
    $('#e-lang').value = w.lang;
    $('#e-hint-en').value = w.hint_en || '';
    $('#e-hint-ar').value = w.hint_ar || '';
    $('#e-active').checked = !!w.active;
    $('#e-cat').innerHTML = catOptions(w.category_id || '', 'pick');
    $('#e-alert').hidden = true;
    $('#e-word').dir = w.lang === 'ar' ? 'rtl' : 'ltr';
    $('#dlg-word').showModal();
  }

  async function onEditSave(e) {
    e.preventDefault();
    const w = A.editing; if (!w) return;
    const word = U.normalize($('#e-word').value);
    const lang = $('#e-lang').value;
    const alert = $('#e-alert');
    if (!U.isWord(word, lang)) { alert.textContent = t('a_err_invalid_word'); alert.hidden = false; return; }
    const patch = {
      word, lang,
      hint_en: $('#e-hint-en').value.trim() || null,
      hint_ar: $('#e-hint-ar').value.trim() || null,
      category_id: $('#e-cat').value ? Number($('#e-cat').value) : null,
      active: $('#e-active').checked
    };
    const btn = $('#e-save');
    btn.classList.add('loading');
    try {
      await API.admin.updateWord(w.id, patch);
      Object.assign(w, patch);
      $('#dlg-word').close();
      renderWords();
      toast(t('a_saved'), 'success');
    } catch (err) {
      alert.textContent = errText(err); alert.hidden = false;
    } finally { btn.classList.remove('loading'); }
  }

  /* ── bulk add ── */
  function parseBulk() {
    const sel = $('#w-bulk-lang').value;
    const existing = new Set(A.words.map(w => w.lang + ':' + w.word));
    const seen = new Set();
    return $('#w-bulk').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      let [raw, h1 = '', h2 = ''] = line.split('|').map(s => s.trim());
      const word = U.normalize(raw);
      const lang = sel === 'auto' ? U.detectLang(word) : sel;
      // be forgiving: an Arabic hint written in the English slot moves to the Arabic slot
      if (h1 && !h2 && U.detectLang(h1) === 'ar') { h2 = h1; h1 = ''; }
      let status = 'ok', reason = '';
      const len = U.chars(word).length;
      if (!U.isWord(word, lang)) { status = 'bad'; reason = len < 3 || len > 8 ? t('a_reason_len') : t('a_reason_chars'); }
      else if (existing.has(lang + ':' + word) || seen.has(lang + ':' + word)) status = 'dup';
      seen.add(lang + ':' + word);
      return { raw, word, lang, hint_en: h1 || null, hint_ar: h2 || null, status, reason };
    });
  }

  function renderPreview() {
    if ($('#w-add').hidden) return;
    const p = A.parsed = parseBulk();
    const ok = p.filter(x => x.status === 'ok').length;
    const dup = p.filter(x => x.status === 'dup').length;
    const bad = p.filter(x => x.status === 'bad').length;
    $('#w-sum').innerHTML = p.length
      ? `<span class="s-ok">${esc(t('a_prev_ok', { n: ok }))}</span>` +
        (dup ? `<span class="s-dup">${esc(t('a_prev_dup', { n: dup }))}</span>` : '') +
        (bad ? `<span class="s-bad">${esc(t('a_prev_bad', { n: bad }))}</span>` : '')
      : '';
    $('#w-preview').innerHTML = p.length
      ? p.slice(0, 120).map(x => `<span class="chip ${x.status}" title="${esc(x.reason || x.lang)}" dir="${x.lang === 'ar' ? 'rtl' : 'ltr'}">${esc(x.lang === 'en' ? x.word.toUpperCase() : x.word || x.raw)}</span>`).join('')
      : `<span class="placeholder">${esc(t('a_prev_empty'))}</span>`;
    const btn = $('#w-add-save');
    btn.textContent = t('a_add_n', { n: ok });
    btn.disabled = !ok;
  }

  function toggleAdd(open) {
    const card = $('#w-add');
    card.hidden = open === undefined ? !card.hidden : !open;
    if (!card.hidden) { renderPreview(); setTimeout(() => $('#w-bulk').focus(), 30); }
  }

  async function saveBulk() {
    const category_id = $('#w-bulk-cat').value ? Number($('#w-bulk-cat').value) : null;
    const rows = A.parsed.filter(x => x.status === 'ok').map(({ word, lang, hint_en, hint_ar }) => ({ word, lang, hint_en, hint_ar, category_id }));
    if (!rows.length) return;
    const btn = $('#w-add-save');
    btn.classList.add('loading');
    try {
      const r = await API.admin.addWords(rows);
      const skipped = r.skipped + A.parsed.length - rows.length;
      toast(t('a_added', { n: r.inserted, s: skipped }), 'success', 3200);
      $('#w-bulk').value = '';
      toggleAdd(false);
      await loadWords();
    } catch (err) { handleErr(err); }
    finally { btn.classList.remove('loading'); }
  }

  /* ═══════════════════════ categories ═══════════════════════ */
  async function loadCategories() {
    A.categories = await API.admin.listCategories();
    renderCategories();
  }

  function renderCategories() {
    const rows = A.categories;
    $('#cat-table').innerHTML = `<thead><tr>
      <th>${esc(t('a_cat_name_ar'))}</th><th>${esc(t('a_cat_name_en'))}</th><th>${esc(t('a_col_words'))}</th><th></th></tr></thead><tbody>` +
      (rows.length ? rows.map(c => `<tr data-id="${c.id}">
        <td dir="rtl"><strong>${esc(c.name_ar)}</strong></td>
        <td dir="ltr">${esc(c.name_en)}</td>
        <td class="num">${nf(c.words)}</td>
        <td class="acts">
          <button class="icon-act" type="button" data-act="edit" title="${esc(t('a_edit_category'))}">${ICON.edit}</button>
          <button class="icon-act del" type="button" data-act="delete" title="${esc(t('a_delete'))}">${ICON.del}</button>
        </td></tr>`).join('')
        : `<tr class="empty-row"><td colspan="4">${esc(t('a_no_rows'))}</td></tr>`) + '</tbody>';
    updateCatPreview();
  }

  function updateCatPreview() {
    const v = (A.lang === 'ar' ? $('#cat-ar').value : $('#cat-en').value).trim()
      || ($('#cat-ar').value || $('#cat-en').value).trim();
    $('#cat-preview-name').textContent = v || '—';
  }

  async function onAddCategory(e) {
    e.preventDefault();
    const name_ar = $('#cat-ar').value.trim(), name_en = $('#cat-en').value.trim();
    const alert = $('#cat-alert');
    alert.hidden = true;
    if (!name_ar || !name_en) { alert.textContent = t('a_err_cat_names'); alert.hidden = false; return; }
    const btn = $('#cat-add');
    btn.classList.add('loading');
    try {
      await API.admin.addCategory({ name_ar, name_en });
      $('#cat-ar').value = ''; $('#cat-en').value = '';
      toast(t('a_saved'), 'success');
      await loadCategories();
    } catch (err) {
      alert.textContent = err.code === 'DUPLICATE' ? t('a_err_cat_dup') : errText(err); alert.hidden = false;
    } finally { btn.classList.remove('loading'); }
  }

  async function onCatTable(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('tr').dataset.id);
    const c = A.categories.find(x => x.id === id);
    if (!c) return;
    if (btn.dataset.act === 'edit') {
      A.editingCat = c;
      $('#ce-ar').value = c.name_ar; $('#ce-en').value = c.name_en;
      $('#ce-alert').hidden = true;
      $('#dlg-cat').showModal();
    } else if (btn.dataset.act === 'delete') {
      if (!(await confirmBox(t('a_delete'), t('a_confirm_delete_cat', { c: catName(c) })))) return;
      try { await API.admin.deleteCategory(id); toast(t('a_deleted'), 'success'); await loadCategories(); }
      catch (err) { handleErr(err); }
    }
  }

  async function onEditCategory(e) {
    e.preventDefault();
    const c = A.editingCat; if (!c) return;
    const name_ar = $('#ce-ar').value.trim(), name_en = $('#ce-en').value.trim();
    const alert = $('#ce-alert');
    if (!name_ar || !name_en) { alert.textContent = t('a_err_cat_names'); alert.hidden = false; return; }
    const btn = $('#ce-save');
    btn.classList.add('loading');
    try {
      await API.admin.updateCategory(c.id, { name_ar, name_en });
      $('#dlg-cat').close();
      toast(t('a_saved'), 'success');
      await loadCategories();
    } catch (err) {
      alert.textContent = err.code === 'DUPLICATE' ? t('a_err_cat_dup') : errText(err); alert.hidden = false;
    } finally { btn.classList.remove('loading'); }
  }

  /* ═══════════════════════ dictionary ═══════════════════════ */
  const EN_DICT_URL = 'https://cdn.jsdelivr.net/npm/an-array-of-english-words@2.0.0/index.json';

  async function loadDictionary() {
    const [counts, st] = await Promise.all([API.admin.dictCounts(), API.admin.getSettings()]);
    A.dict = counts;
    A.settings = { ...A.settings, ...st };
    renderDictionary();
  }

  function renderDictionary() {
    $('#dict-off').hidden = !!A.settings.require_known_words;
    $$('.dict-card').forEach(card => {
      const n = A.dict[card.dataset.lang] || 0;
      card.querySelector('[data-count]').textContent = nf(n);
      card.querySelector('[data-warn]').hidden = n > 0;
      card.querySelector('[data-clear]').hidden = n === 0;
      card.querySelectorAll('button, .file-btn').forEach(b => b.classList.toggle('loading', false));
    });
  }

  function setProgress(lang, done, total, label) {
    const card = $(`.dict-card[data-lang="${lang}"]`);
    const box = card.querySelector('[data-progress]');
    box.hidden = false;
    box.querySelector('i').style.width = total ? `${Math.round(done * 100 / total)}%` : '8%';
    box.querySelector('small').textContent = label || t('a_dict_importing', { d: nf(done), t: nf(total) });
  }
  function endProgress(lang) {
    const card = $(`.dict-card[data-lang="${lang}"]`);
    card.querySelector('[data-progress]').hidden = true;
    card.querySelectorAll('.btn').forEach(b => { b.classList.remove('loading'); b.removeAttribute('disabled'); });
  }
  function busyCard(lang) {
    const card = $(`.dict-card[data-lang="${lang}"]`);
    card.querySelectorAll('.btn').forEach(b => b.setAttribute('disabled', ''));
  }

  function cleanWordList(text, lang) {
    const out = new Set();
    String(text).split(/[\s,;|"'\t\r\n]+/).forEach(raw => {
      const w = U.normalize(raw);
      if (w && U.isWord(w, lang)) out.add(w);
    });
    return [...out];
  }

  async function runImport(lang, words) {
    const before = A.dict[lang] || 0;
    await API.admin.importDictionary(lang, words, (d, tot) => setProgress(lang, d, tot));
    A.dict = await API.admin.dictCounts();
    toast(t('a_dict_imported', { n: nf(Math.max(0, A.dict[lang] - before)) }), 'success', 3500);
    renderDictionary();
  }

  async function importEnglish() {
    if (A.importing) return;
    A.importing = true;
    busyCard('en');
    setProgress('en', 0, 0, t('a_dict_downloading'));
    try {
      let list;
      try {
        const r = await fetch(EN_DICT_URL);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        list = await r.json();
      } catch (e) { toast(t('a_dict_fetch_fail'), 'error', 4500); return; }
      await runImport('en', list.filter(w => /^[a-z]{3,8}$/.test(w)));
    } catch (err) { handleErr(err); }
    finally { A.importing = false; endProgress('en'); }
  }

  async function uploadDictionary(lang, file) {
    if (!file || A.importing) return;
    A.importing = true;
    busyCard(lang);
    setProgress(lang, 0, 0, t('a_dict_reading'));
    try {
      const words = cleanWordList(await file.text(), lang);
      if (!words.length) { toast(t('a_err_invalid_word'), 'error'); return; }
      await runImport(lang, words);
    } catch (err) { handleErr(err); }
    finally { A.importing = false; endProgress(lang); }
  }

  async function clearDictionary(lang) {
    const name = t(lang === 'ar' ? 'a_dict_ar' : 'a_dict_en');
    if (!(await confirmBox(t('a_dict_clear'), t('a_dict_confirm_clear', { l: name }), t('a_dict_clear')))) return;
    try {
      await API.admin.clearDictionary(lang);
      A.dict = await API.admin.dictCounts();
      renderDictionary();
      toast(t('a_deleted'), 'success');
    } catch (err) { handleErr(err); }
  }

  async function checkWord(e) {
    e.preventDefault();
    const raw = $('#dict-check-in').value;
    const word = U.normalize(raw);
    const out = $('#dict-check-out');
    if (!word) { out.textContent = ''; return; }
    const lang = U.detectLang(word);
    if (!U.isWord(word, lang)) { out.className = 'check-out no'; out.textContent = t('a_err_invalid_word'); return; }
    try {
      const r = await API.admin.checkWord(word, lang);
      const ok = r.dictionary || r.answers;
      out.className = 'check-out ' + (ok ? 'yes' : 'no');
      out.textContent = `${lang === 'en' ? word.toUpperCase() : word} — ${t(ok ? 'a_dict_yes' : 'a_dict_no')} ${!r.dictionary && r.answers ? t('a_dict_in_answers') : ''}`;
    } catch (err) { handleErr(err); }
  }

  /* ═══════════════════════ results ═══════════════════════ */
  async function loadResults() {
    A.games = await API.admin.listGames(2000);
    renderResults();
  }

  function filteredGames() {
    const f = A.rf, q = f.q.trim().toLowerCase(), qn = U.normalize(f.q);
    const today = dayOf(new Date().toISOString());
    const ss = new Date(A.settings.season_start || 0).getTime();
    return A.games.filter(g => {
      if (f.status !== 'all' && g.status !== f.status) return false;
      if (f.range === 'today' && dayOf(g.started_at) !== today) return false;
      if (f.range === 'season' && new Date(g.started_at).getTime() < ss) return false;
      if (!q) return true;
      const p = g.players || {};
      return (p.full_name || '').toLowerCase().includes(q) || (p.id_number || '').includes(q) || (g.answer || '').includes(qn);
    });
  }

  function gamesTable(rows, withActions = true) {
    const head = `<thead><tr>
      <th>${esc(t('a_col_date'))}</th><th>${esc(t('a_col_player'))}</th><th>${esc(t('a_col_word'))}</th>
      <th>${esc(t('a_col_attempts'))}</th><th>${esc(t('a_col_result'))}</th><th>${esc(t('a_col_score'))}</th>
      <th>${esc(t('a_col_time'))}</th>${withActions ? '<th></th>' : ''}</tr></thead>`;
    const body = rows.length ? rows.map(g => {
      const p = g.players || {};
      const n = (g.guesses || []).length;
      const guesses = (g.guesses || []).map(x => (g.lang === 'en' ? x.toUpperCase() : x)).join(' · ');
      return `<tr data-id="${esc(g.id)}">
        <td class="nowrap">${esc(fmtDate(g.started_at))}</td>
        <td><strong>${esc(p.full_name || '—')}</strong><span class="sub" dir="ltr">${esc(p.id_number || '')}</span></td>
        <td>${miniWord(g.answer, g.lang, g.status === 'won' ? 'won' : '')}${guesses ? `<span class="guesses" dir="${g.lang === 'ar' ? 'rtl' : 'ltr'}">${esc(guesses)}</span>` : ''}</td>
        <td class="num">${n}/${g.max_attempts}</td>
        <td><span class="badge ${esc(g.status)}">${esc(t('st_' + g.status))}</span>${g.end_reason ? `<span class="sub">${esc(t('rs_' + g.end_reason))}</span>` : ''}</td>
        <td class="num"><strong>${nf(g.score)}</strong>${g.hint_used ? ` <span class="hint-flag" title="${esc(t('a_hint_used'))}">${ICON.bulb}</span>` : ''}</td>
        <td class="num">${fmtDur(g.duration_ms)}</td>
        ${withActions ? `<td class="acts"><button class="icon-act del" type="button" data-act="delete" title="${esc(t('a_delete'))}">${ICON.del}</button></td>` : ''}
      </tr>`;
    }).join('') : `<tr class="empty-row"><td colspan="${withActions ? 8 : 7}">${esc(t('a_no_rows'))}</td></tr>`;
    return head + '<tbody>' + body + '</tbody>';
  }

  function renderResults() {
    const rows = filteredGames();
    $('#r-table').innerHTML = gamesTable(rows.slice(0, 500));
    $('#r-count').textContent = t('a_results_count', { n: nf(rows.length) });
  }

  async function onResultsTable(e) {
    const btn = e.target.closest('[data-act="delete"]');
    if (!btn) return;
    const id = btn.closest('tr').dataset.id;
    if (!(await confirmBox(t('a_delete'), t('a_confirm_delete_game')))) return;
    try {
      await API.admin.deleteGame(id);
      A.games = A.games.filter(g => g.id !== id);
      renderResults();
      toast(t('a_deleted'), 'success');
    } catch (err) { handleErr(err); }
  }

  function exportResults() {
    const rows = filteredGames();
    downloadCSV(`pam-word-results-${dayOf(new Date().toISOString())}.csv`,
      ['date', 'player', 'id_number', 'word', 'language', 'attempts', 'max_attempts', 'status', 'reason', 'score', 'hint_used', 'duration_sec', 'guesses'],
      rows.map(g => [
        g.started_at, (g.players || {}).full_name, (g.players || {}).id_number, g.answer, g.lang,
        (g.guesses || []).length, g.max_attempts, g.status, g.end_reason, g.score, g.hint_used ? 'yes' : 'no',
        g.duration_ms != null ? Math.round(g.duration_ms / 1000) : '', (g.guesses || []).join(' ')
      ]));
  }

  /* ═══════════════════════ champions ═══════════════════════ */
  async function loadChampions() {
    A.board = await API.admin.leaderboard(A.period, 500);
    renderChampions();
  }

  function renderChampions() {
    const rows = A.board;
    $('#c-table').innerHTML = `<thead><tr>
      <th>${esc(t('a_col_rank'))}</th><th>${esc(t('a_col_player'))}</th><th>${esc(t('a_col_id'))}</th>
      <th>${esc(t('a_col_points'))}</th><th>${esc(t('a_col_wins'))}</th><th>${esc(t('a_col_games'))}</th>
      <th>${esc(t('a_col_winrate'))}</th><th>${esc(t('a_col_best'))}</th></tr></thead><tbody>` +
      (rows.length ? rows.map(r => `<tr>
        <td><span class="mini-board"><span class="rk ${r.rank <= 3 ? 'r' + r.rank : ''}" style="display:inline-grid;width:28px;height:28px;border-radius:50%;place-items:center;font-weight:700;font-size:.8rem;${r.rank > 3 ? 'background:rgba(255,255,255,.08)' : ''}">${r.rank}</span></span></td>
        <td><strong>${esc(r.full_name)}</strong></td>
        <td class="num" dir="ltr">${esc(r.id_display)}</td>
        <td class="num"><strong style="color:var(--accent-hi)">${nf(r.total_score)}</strong></td>
        <td class="num">${nf(r.wins)}</td>
        <td class="num">${nf(r.games)}</td>
        <td class="num">${r.games ? Math.round(r.wins * 100 / r.games) : 0}%</td>
        <td class="num">${fmtDur(r.best_time_ms)}</td></tr>`).join('')
        : `<tr class="empty-row"><td colspan="8">${esc(t('a_no_rows'))}</td></tr>`) + '</tbody>';

    $('#c-season-info').textContent = t('a_season_info', {
      name: A.settings.season_name || '—',
      date: fmtDate(A.settings.season_start, false)
    });
  }

  function exportChampions() {
    downloadCSV(`pam-word-champions-${A.period}-${dayOf(new Date().toISOString())}.csv`,
      ['rank', 'player', 'id_number', 'points', 'wins', 'games', 'win_rate', 'best_time_sec'],
      A.board.map(r => [r.rank, r.full_name, r.id_display, r.total_score, r.wins, r.games,
        r.games ? Math.round(r.wins * 100 / r.games) + '%' : '0%',
        r.best_time_ms != null ? Math.round(r.best_time_ms / 1000) : '']));
  }

  async function newSeason() {
    if (!(await confirmBox(t('a_new_season'), t('a_confirm_season'), t('a_new_season')))) return;
    const btn = $('#c-new-season');
    btn.classList.add('loading');
    try {
      await API.admin.newSeason($('#c-season-name').value.trim());
      A.settings = { ...A.settings, ...(await API.admin.getSettings()) };
      $('#c-season-name').value = '';
      toast(t('a_season_started'), 'success');
      await loadChampions();
    } catch (err) { handleErr(err); }
    finally { btn.classList.remove('loading'); }
  }

  /* ═══════════════════════ settings ═══════════════════════ */
  async function loadSettings() {
    A.settings = { ...A.settings, ...(await API.admin.getSettings()) };
    A.dirty = false;
    renderSettings();
  }

  function fieldHtml(f) {
    const v = A.settings[f.k];
    const help = I18N.has('sh_' + f.k) ? `<small>${esc(t('sh_' + f.k))}</small>` : '';
    const lbl = `<span class="lbl">${esc(t('s_' + f.k))}${help}</span>`;
    if (f.type === 'bool') {
      return `<label class="set-row">${lbl}<span class="switch"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}><span></span></span></label>`;
    }
    if (f.type === 'select') {
      return `<label class="set-row">${lbl}<select name="${f.k}">${f.options.map(o =>
        `<option value="${o}" ${o === v ? 'selected' : ''}>${esc(t('o_' + o))}</option>`).join('')}</select></label>`;
    }
    if (f.type === 'number') {
      return `<label class="set-row">${lbl}<input type="number" name="${f.k}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${esc(v)}" dir="ltr"></label>`;
    }
    return `<label class="set-row">${lbl}<input type="text" name="${f.k}" value="${esc(v)}" maxlength="60" ${f.dir ? `dir="${f.dir}"` : ''}></label>`;
  }

  function renderSettings() {
    $('#s-form').innerHTML = FIELDS.map(g =>
      `<section class="card set-group"><h3>${esc(t(g.g))}</h3>${g.items.map(fieldHtml).join('')}</section>`).join('');
    $('#s-bar').classList.toggle('show', A.dirty);
  }

  function collectSettings() {
    const form = $('#s-form');
    const out = {};
    FIELDS.flatMap(g => g.items).forEach(f => {
      const el = form.elements[f.k];
      if (!el) return;
      if (f.type === 'bool') out[f.k] = el.checked;
      else if (f.type === 'number') {
        const n = parseInt(el.value, 10);
        out[f.k] = Math.min(f.max, Math.max(f.min, Number.isFinite(n) ? n : f.min));
      } else out[f.k] = el.value.trim();
    });
    return out;
  }

  async function saveSettings() {
    const patch = collectSettings();
    if (patch.id_min_length > patch.id_max_length) { toast(t('a_err_id_range'), 'error'); return; }
    if (!patch.event_title_ar) patch.event_title_ar = API.DEFAULT_SETTINGS.event_title_ar;
    if (!patch.event_title_en) patch.event_title_en = API.DEFAULT_SETTINGS.event_title_en;
    if (!patch.season_name) patch.season_name = A.settings.season_name;
    try { new Intl.DateTimeFormat('en', { timeZone: patch.timezone }); } catch (e) { patch.timezone = 'Asia/Kuwait'; }
    const btn = $('#s-save');
    btn.classList.add('loading');
    try {
      const saved = await API.admin.saveSettings(patch);
      A.settings = { ...A.settings, ...saved };
      A.dirty = false;
      renderSettings();
      toast(t('a_saved'), 'success');
    } catch (err) { handleErr(err); }
    finally { btn.classList.remove('loading'); }
  }

  /* ═══════════════════════ events ═══════════════════════ */
  function bind() {
    $('#login-form').addEventListener('submit', onLogin);
    $$('[data-lang-toggle]').forEach(b => b.addEventListener('click', () => setLang(A.lang === 'ar' ? 'en' : 'ar')));
    $('#btn-logout').addEventListener('click', logout);
    $('#nav').addEventListener('click', e => { const b = e.target.closest('[data-nav]'); if (b) go(b.dataset.nav); });
    $$('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));

    // words
    $('#w-search').addEventListener('input', e => { A.wf.q = e.target.value; renderWords(); });
    $('#w-lang').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; A.wf.lang = b.dataset.v; setSeg('w-lang', b.dataset.v); renderWords(); });
    $('#w-status').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; A.wf.status = b.dataset.v; setSeg('w-status', b.dataset.v); renderWords(); });
    $('#w-table').addEventListener('click', onWordsTable);
    $('#w-table').addEventListener('change', onWordsTable);
    $('#w-add-toggle').addEventListener('click', () => toggleAdd());
    $('#w-add-cancel').addEventListener('click', () => toggleAdd(false));
    $('#w-bulk').addEventListener('input', renderPreview);
    $('#w-bulk-lang').addEventListener('change', renderPreview);
    $('#w-add-save').addEventListener('click', saveBulk);
    $('#word-form').addEventListener('submit', onEditSave);
    $('#e-cancel').addEventListener('click', () => $('#dlg-word').close());
    $('#e-lang').addEventListener('change', e => { $('#e-word').dir = e.target.value === 'ar' ? 'rtl' : 'ltr'; });

    $('#w-cat').addEventListener('change', e => { A.wf.cat = e.target.value; renderWords(); });

    // categories
    $('#cat-form').addEventListener('submit', onAddCategory);
    $('#cat-ar').addEventListener('input', updateCatPreview);
    $('#cat-en').addEventListener('input', updateCatPreview);
    $('#cat-table').addEventListener('click', onCatTable);
    $('#cat-edit-form').addEventListener('submit', onEditCategory);
    $('#ce-cancel').addEventListener('click', () => $('#dlg-cat').close());

    // dictionary
    $('#dict-import-en').addEventListener('click', importEnglish);
    $$('.dict-card').forEach(card => {
      const lang = card.dataset.lang;
      card.querySelector('[data-upload]').addEventListener('change', e => {
        const f = e.target.files[0]; e.target.value = '';
        uploadDictionary(lang, f);
      });
      card.querySelector('[data-clear]').addEventListener('click', () => clearDictionary(lang));
    });
    $('#dict-check-form').addEventListener('submit', checkWord);
    window.addEventListener('beforeunload', e => { if (A.importing) { e.preventDefault(); e.returnValue = ''; } });

    // results
    $('#r-search').addEventListener('input', e => { A.rf.q = e.target.value; renderResults(); });
    $('#r-status').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; A.rf.status = b.dataset.v; setSeg('r-status', b.dataset.v); renderResults(); });
    $('#r-range').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; A.rf.range = b.dataset.v; setSeg('r-range', b.dataset.v); renderResults(); });
    $('#r-table').addEventListener('click', onResultsTable);
    $('#r-export').addEventListener('click', exportResults);

    // champions
    $('#c-period').addEventListener('click', async e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      A.period = b.dataset.v; setSeg('c-period', A.period);
      try { await loadChampions(); } catch (err) { handleErr(err); }
    });
    $('#c-export').addEventListener('click', exportChampions);
    $('#c-new-season').addEventListener('click', newSeason);

    // settings
    const mark = () => { A.dirty = true; $('#s-bar').classList.add('show'); };
    $('#s-form').addEventListener('input', mark);
    $('#s-form').addEventListener('change', mark);
    $('#s-save').addEventListener('click', saveSettings);

    window.addEventListener('beforeunload', e => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });
    // keep the dashboard fresh while it is open
    setInterval(() => { if (!$('#shell').hidden && A.page === 'dashboard' && !document.hidden) loadDashboard().catch(() => {}); }, 60000);
  }

  /* ═══════════════════════ boot ═══════════════════════ */
  async function boot() {
    const logo = cfg.LOGO_URL || 'assets/logo.svg';
    $('#login-logo').src = logo;
    $('#side-logo').src = logo;
    bind();
    setLang(A.lang);
    let user = null;
    try { user = await API.auth.session(); } catch (e) { /* ignore */ }
    if (user) { A.user = user; await enter(); } else showLogin();
  }

  boot();
})();
