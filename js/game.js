/* ─────────────────────────────────────────────────────────────────────────
   PAM Word Challenge — kiosk game controller
   Screens: home (attract) → register → game → result → home
   ───────────────────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const U = API.util;
  const t = (k, v) => I18N.t(k, v);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nf = n => Number(n || 0).toLocaleString('en-US');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const SVG = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m17 9-6 6M11 9l6 6"/></svg>',
    enter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10l-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>'
  };

  const KB = {
    en: [[...'qwertyuiop'], [...'asdfghjkl'], ['enter', ...'zxcvbnm', 'back']],
    // rows listed LEFT → RIGHT exactly as on the iPhone/iPad Arabic keyboard;
    // ئ ؤ (long-press letters on iOS) sit bottom-left, where iOS has 123
    ar: [[...'ضصثقفغعهخحج'], [...'شسيبلاتنمكة'], [...'ءظطذدزروى', 'back'], ['ئ', 'ؤ', 'enter']]
  };

  const DEMO_WORDS = {
    en: ['SMART', 'CLOUD', 'PIXEL', 'LOGIC', 'CYBER'],
    ar: ['ذكاء', 'سحابة', 'تقنية', 'شبكة', 'برمجة']
  };

  const S = {
    lang: 'ar',                       // the game is Arabic-only
    settings: { ...API.DEFAULT_SETTINGS },
    screen: null,
    player: null,
    game: null,
    row: 0, cur: [], busy: false, over: false, keys: {}, hint: null,
    idle: null, autoclose: null, homeTimers: [], demoIdx: 0,
    timer: null, deadline: 0, lastTick: -1,
    lbPeriod: 'season', confirmDone: null, wake: null
  };

  /* ═══════════════════════ helpers ═══════════════════════ */
  const display = (ch, lang) => (lang === 'en' ? ch.toUpperCase() : ch);
  const fmtTime = sec => {
    sec = Math.max(0, Math.round(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };
  const initials = name => String(name || '').trim().split(/\s+/).slice(0, 2)
    .map(p => Array.from(p)[0] || '').join('').toUpperCase();

  function errMsg(e) {
    const code = (e && e.code) || 'GENERIC';
    const key = 'err_' + code.toLowerCase();
    return I18N.has(key)
      ? t(key, { min: S.settings.id_min_length, max: S.settings.id_max_length })
      : t('err_generic');
  }

  function toast(msg, type = 'info', ms = 2300) {
    const wrap = $('#toasts');
    while (wrap.children.length > 1) wrap.firstChild.remove();
    const n = h('div', 'toast ' + type, msg);
    wrap.appendChild(n);
    requestAnimationFrame(() => n.classList.add('show'));
    setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, ms);
  }

  function openOverlay(el) {
    el.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  }
  function closeOverlay(el) {
    if (el.hidden) return;
    el.classList.remove('open');
    setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 300);
  }

  function ask(title, text, okLabel) {
    return new Promise(resolve => {
      const o = $('#confirm');
      $('#c-title').textContent = title;
      $('#c-text').textContent = text;
      $('#c-ok').textContent = okLabel || t('confirm_yes');
      $('#c-cancel').textContent = t('confirm_no');
      const done = v => {
        S.confirmDone = null;
        $('#c-ok').onclick = $('#c-cancel').onclick = null;
        closeOverlay(o);
        resolve(v);
      };
      S.confirmDone = done;
      $('#c-ok').onclick = () => { Sound.tap(); done(true); };
      $('#c-cancel').onclick = () => { Sound.tap(); done(false); };
      openOverlay(o);
    });
  }
  const closeConfirm = () => { if (S.confirmDone) S.confirmDone(false); };

  /* ═══════════════════════ language ═══════════════════════ */
  function setLang(l) {
    S.lang = l === 'en' ? 'en' : 'ar';
    I18N.set(S.lang);
    renderStatic();
    buildAmbient();
    if (S.screen === 'home') { loadHomeChampions(); playDemo(); }
    if (S.screen === 'board') loadBoard();
    if (S.screen === 'register') clearRegErrors();
    if (S.screen === 'game' && S.game) { renderCategory(); renderHead(); }
  }

  function renderStatic() {
    const st = S.settings;
    const title = (S.lang === 'ar' ? st.event_title_ar : st.event_title_en) || t('hero_badge');
    $('#hero-title').textContent = title;
    document.title = `${title} · ${t('org_name')}`;
    $('#hero-sub').textContent = t('tagline', { n: st.max_attempts });
    $('#season-chip').textContent = st.season_name || '';
    $('#season-chip').hidden = !st.season_name;
    $('#footer').textContent = t('footer', { y: new Date().getFullYear() });

    // rules
    const rules = [t('rule_1', { n: st.max_attempts }), t('rule_cat'), t('rule_img'), t('rule_2'), t('rule_3'), t('rule_real')];
    if (st.timer_enabled && st.time_limit_seconds > 0) {
      const tl = st.time_limit_seconds;
      rules.push(t('rule_time', { t: tl % 60 === 0 ? `${tl / 60} ${t('minutes')}` : `${tl} ${t('seconds')}` }));
    }
    $('#rules').replaceChildren(...rules.map(r => h('li', '', r)));

    // examples
    const ex = S.lang === 'ar'
      ? [['شبكة', 0, 'correct', 'ex_correct'], ['تقنية', 2, 'present', 'ex_present'], ['سحابة', 3, 'absent', 'ex_absent']]
      : [['CLOUD', 0, 'correct', 'ex_correct'], ['PIXEL', 1, 'present', 'ex_present'], ['LOGIC', 3, 'absent', 'ex_absent']];
    $('#examples').replaceChildren(...ex.map(([w, idx, st2, key]) => {
      const row = h('div', 'example');
      const tiles = h('div', 'ex-row');
      tiles.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
      Array.from(w).forEach((ch, i) => {
        const tile = h('div', 'tile', ch);
        if (i === idx) tile.dataset.state = st2;
        tiles.appendChild(tile);
      });
      row.append(tiles, h('p', '', t(key)));
      return row;
    }));
  }

  /* ═══════════════════════ screens ═══════════════════════ */
  function show(name) {
    // inactive screens fade out, then leave the render tree entirely (no ghosting, no wasted GPU)
    $$('.screen').forEach(sc => {
      const on = sc.dataset.screen === name;
      clearTimeout(sc._gone);
      if (on) {
        sc.classList.remove('gone');
        void sc.offsetWidth;
        sc.classList.add('active');
      } else {
        sc.classList.remove('active');
        sc._gone = setTimeout(() => sc.classList.add('gone'), 620);
      }
    });
    S.screen = name;
    document.body.dataset.screen = name;
    if (name === 'home') startHome(); else stopHome();
    resetIdle();
  }

  function goHome() {
    clearInterval(S.autoclose);
    stopTimer();
    closeConfirm();
    closeOverlay($('#result'));
    closeOverlay($('#lightbox'));
    S.player = null;
    S.game = null;
    show('home');
  }

  /* ═══════════════════════ home ═══════════════════════ */
  function startHome() {
    stopHome();
    loadHomeChampions();
    playDemo();
    S.homeTimers.push(setInterval(playDemo, 4600));
    S.homeTimers.push(setInterval(loadHomeChampions, 45000));
    S.homeTimers.push(setInterval(refreshSettings, 5 * 60000));
  }
  function stopHome() { S.homeTimers.forEach(clearInterval); S.homeTimers = []; }

  function playDemo() {
    const words = DEMO_WORDS[S.lang];
    const idx = S.demoIdx++;
    const letters = Array.from(words[idx % words.length]);
    const row = $('#demo-row');
    row.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    const tiles = letters.map(ch => h('div', 'tile filled', ch));
    row.replaceChildren(...tiles);
    const solved = idx % 2 === 1;
    const pool = ['correct', 'present', 'absent', 'correct', 'absent'];
    tiles.forEach((tile, i) => {
      const st = solved ? 'correct' : pool[(i + idx) % pool.length];
      flipTile(tile, st, 500 + i * 170, false);
    });
    if (solved) {
      setTimeout(() => tiles.forEach((tile, i) => {
        tile.style.setProperty('--d', `${i * 90}ms`);
        tile.classList.add('win');
      }), 500 + tiles.length * 170 + 450);
    }
  }

  function buildAmbient() {
    const box = $('#ambient');
    if (!box) return;
    const letters = S.lang === 'ar' ? Array.from('ابتثجحخدرسشصطعفقكلمنهوي') : Array.from('ABCDEFGHIKLMNOPRSTUWY');
    const rnd = (a, b) => a + Math.random() * (b - a);
    const n = 14;
    box.replaceChildren(...Array.from({ length: n }, (_, i) => {
      const t = h('span', 'float-tile' + (i % 5 === 0 ? ' g' : i % 7 === 0 ? ' y' : ''), letters[Math.floor(Math.random() * letters.length)]);
      const dur = rnd(16, 30);
      t.style.cssText =
        `--x:${(i / n * 100 + rnd(-3, 3)).toFixed(1)}%;--s:${rnd(2.4, 4.6).toFixed(2)}rem;` +
        `--dur:${dur.toFixed(1)}s;--delay:${(-rnd(0, dur)).toFixed(1)}s;--o:${rnd(.25, .6).toFixed(2)};` +
        `--dx:${rnd(-4, 4).toFixed(1)}rem;--r0:${rnd(-18, 18).toFixed(0)}deg;--r1:${rnd(-30, 30).toFixed(0)}deg`;
      return t;
    }));
  }

  async function loadHomeChampions() {
    const card = $('#home-champions');
    card.hidden = !S.settings.show_leaderboard;
    if (card.hidden) return;
    try {
      const rows = await API.getLeaderboard('season', 5);
      const list = $('#home-champ-list');
      list.replaceChildren(...(rows.length ? rows.map(champItem) : [h('li', 'empty', t('board_empty'))]));
    } catch (e) { /* keep last list */ }
  }

  function champItem(r, i = 0) {
    const li = h('li', 'champ' + (r.rank <= 3 ? ` r${r.rank}` : '') + (r.is_me ? ' me' : ''));
    li.style.setProperty('--i', i);
    li.innerHTML =
      `<span class="rank">${r.rank}</span>` +
      `<span class="avatar">${esc(initials(r.full_name))}</span>` +
      `<span class="who"><strong>${esc(r.full_name)}</strong></span>` +
      (S.screen === 'board' ? `<span class="wins"><b>${nf(r.wins)}</b>${esc(t('a_col_wins'))}</span>` : '') +
      `<span class="pts"><b>${nf(r.total_score)}</b><small>${esc(t('pts'))}</small></span>`;
    return li;
  }

  async function refreshSettings() {
    try {
      S.settings = { ...S.settings, ...(await API.getSettings()) };
      Sound.enabled = !!S.settings.sound_enabled;
      renderStatic();
    } catch (e) { /* offline: keep cached */ }
  }

  /* ═══════════════════════ register ═══════════════════════ */
  function clearRegErrors() {
    ['name', 'id'].forEach(k => { $('#f-' + k).classList.remove('invalid'); $('#err-' + k).textContent = ''; });
    $('#reg-alert').hidden = true;
  }

  function openRegister() {
    Sound.tap();
    $('#reg-form').reset();
    clearRegErrors();
    show('register');
    setTimeout(() => $('#in-name').focus({ preventScroll: true }), 420);
  }

  function regAlert(msg, info = false) {
    const a = $('#reg-alert');
    a.textContent = msg;
    a.classList.toggle('info', info);
    a.hidden = false;
  }

  async function onRegister(e) {
    e.preventDefault();
    clearRegErrors();
    const name = $('#in-name').value.trim().replace(/\s+/g, ' ');
    const id = $('#in-id').value.replace(/\D/g, '');
    let ok = true;
    if (Array.from(name).length < 3) {
      $('#f-name').classList.add('invalid'); $('#err-name').textContent = t('err_invalid_name'); ok = false;
    }
    if (id.length < S.settings.id_min_length || id.length > S.settings.id_max_length) {
      $('#f-id').classList.add('invalid');
      $('#err-id').textContent = t('err_invalid_id', { min: S.settings.id_min_length, max: S.settings.id_max_length });
      ok = false;
    }
    if (!ok) { Sound.error(); return; }

    const btn = $('#btn-reg');
    btn.classList.add('loading');
    document.activeElement && document.activeElement.blur();
    try {
      S.player = await API.registerPlayer(name, id);
      if (S.player.plays_left === 0) { Sound.error(); regAlert(t('err_daily_limit'), true); return; }
      await beginGame();
    } catch (err) {
      Sound.error();
      regAlert(errMsg(err), err.code === 'DAILY_LIMIT');
    } finally {
      btn.classList.remove('loading');
    }
  }

  /* ═══════════════════════ game ═══════════════════════ */
  async function beginGame() {
    const g = await API.startGame(S.player.player_id, S.lang);
    Object.assign(S, { game: g, row: 0, cur: [], busy: false, over: false, keys: {}, hint: null });
    S.player.plays_left = g.plays_left;
    buildBoard();
    paintRow();
    buildKeyboard();
    renderHead();
    renderCategory();
    $('#hint-banner').hidden = true;
    show('game');
    startTimer();
  }

  function buildBoard() {
    const g = S.game, b = $('#board');
    b.style.setProperty('--len', g.length);
    b.style.setProperty('--rows', g.max_attempts);
    b.dir = g.lang === 'ar' ? 'rtl' : 'ltr';
    const rows = [];
    for (let r = 0; r < g.max_attempts; r++) {
      const row = h('div', 'row' + (r === 0 ? ' current' : ''));
      for (let c = 0; c < g.length; c++) row.appendChild(h('div', 'tile'));
      rows.push(row);
    }
    b.replaceChildren(...rows);
  }

  function buildKeyboard() {
    const lang = S.game.lang, kb = $('#keyboard');
    kb.dir = 'ltr';                       // keys keep their physical positions, like a real keyboard
    kb.dataset.lang = lang;
    kb.replaceChildren(...KB[lang].map(keys => {
      const row = h('div', 'kb-row' + (keys.every(k => k.length > 1) ? ' actions' : '') + (keys.includes('enter') ? ' has-enter' : ''));
      keys.forEach(k => {
        const b = h('button', 'key');
        b.type = 'button';
        b.dataset.key = k;
        if (k === 'enter') { b.classList.add('wide', 'key-enter'); b.innerHTML = `<span>${esc(t('enter'))}</span>${SVG.enter}`; }
        else if (k === 'back') { b.classList.add('wide'); b.innerHTML = SVG.back; b.setAttribute('aria-label', 'Backspace'); }
        else b.textContent = k;
        row.appendChild(b);
      });
      return row;
    }));
  }

  function renderHead() {
    $('#g-avatar').textContent = initials(S.player.full_name);
    $('#g-name').textContent = S.player.full_name;
    const pl = S.game.plays_left;
    $('#g-sub').textContent = pl == null ? t('plays_unlimited') : t('plays_left', { n: pl });
    const hb = $('#btn-hint');
    hb.hidden = !(S.game.has_hint && S.settings.hints_enabled);
    hb.classList.remove('used');
    renderAttempts();
  }

  // category + optional helper image above the letter boxes
  function renderCategory() {
    const g = S.game;
    if (!g) return;
    const name = g.category_ar || g.category_en || '';
    const chip = $('#g-category'), fig = $('#g-image');
    $('#g-category-name').textContent = name;
    $('#g-image-cat').textContent = name;
    $('#g-image-cap').hidden = !name;
    $('#screen-game').classList.toggle('has-image', !!g.image_url);
    if (!g.image_url) { fig.hidden = true; chip.hidden = !name; return; }

    const img = $('#g-image-img'), bg = $('#g-image-bg');
    if (img.dataset.src !== g.image_url) {
      fig.classList.add('loading');
      img.onload = () => fig.classList.remove('loading');
      img.onerror = () => { fig.hidden = true; chip.hidden = !name; $('#screen-game').classList.remove('has-image'); };   // broken image: fall back to the chip
      img.dataset.src = g.image_url;
      img.src = g.image_url;
      bg.src = g.image_url;
    }
    fig.hidden = false;
    chip.hidden = true;                    // the category is shown as the image caption instead
  }

  function openLightbox() {
    if (!S.game || !S.game.image_url) return;
    Sound.tap();
    $('#lb-img').src = S.game.image_url;
    const name = S.game.category_ar || S.game.category_en || '';
    $('#lb-cap').textContent = name;
    $('#lb-cap').hidden = !name;
    openOverlay($('#lightbox'));
  }

  function renderAttempts() {
    const box = $('#g-attempts'), g = S.game;
    const dots = [];
    for (let i = 0; i < g.max_attempts; i++) {
      dots.push(h('span', 'dot' + (i < S.row ? ' used' : '') + (i === S.row && !S.over ? ' now' : '')));
    }
    dots.push(h('span', 'att-label', t('attempt_of', { a: Math.min(S.row + 1, g.max_attempts), b: g.max_attempts })));
    box.replaceChildren(...dots);
  }

  const rowEl = r => $('#board').children[r];

  function paintRow(popIndex = -1) {
    const tiles = rowEl(S.row).children;
    for (let i = 0; i < tiles.length; i++) {
      const ch = S.cur[i];
      tiles[i].textContent = ch ? display(ch, S.game.lang) : '';
      tiles[i].classList.toggle('filled', !!ch);
      tiles[i].classList.toggle('cursor', i === S.cur.length);
      if (i === popIndex) { tiles[i].classList.remove('pop'); void tiles[i].offsetWidth; tiles[i].classList.add('pop'); }
    }
  }

  function shakeRow() {
    const r = rowEl(S.row);
    r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake');
  }

  function onKey(k) {
    if (S.screen !== 'game' || !S.game || S.busy || S.over) return;
    if (k === 'enter') return submit();
    if (k === 'back') {
      if (S.cur.length) { S.cur.pop(); paintRow(); Sound.del(); }
      return;
    }
    if (S.cur.length >= S.game.length) return;
    S.cur.push(k);
    paintRow(S.cur.length - 1);
    Sound.key();
  }

  function flipTile(tile, state, delay, sound = true) {
    return new Promise(res => {
      setTimeout(() => {
        tile.classList.remove('flip'); void tile.offsetWidth; tile.classList.add('flip');
        setTimeout(() => { tile.dataset.state = state; tile.classList.remove('filled'); if (sound) Sound.flip(state); }, 260);
        setTimeout(() => { tile.classList.remove('flip'); res(); }, 540);
      }, delay);
    });
  }

  async function revealRow(r, result) {
    const tiles = Array.from(rowEl(r).children);
    await Promise.all(tiles.map((tile, i) => flipTile(tile, result[i], i * 260)));
  }

  const RANK = { absent: 1, present: 2, correct: 3 };
  function updateKeys(letters, result) {
    letters.forEach((ch, i) => {
      if ((RANK[result[i]] || 0) > (RANK[S.keys[ch]] || 0)) S.keys[ch] = result[i];
    });
    $$('#keyboard .key').forEach(k => { const st = S.keys[k.dataset.key]; if (st) k.dataset.state = st; });
  }

  async function submit() {
    if (S.cur.length < S.game.length) {
      shakeRow(); Sound.error(); toast(t('err_not_enough'));
      return;
    }
    S.busy = true;
    const letters = S.cur.slice();
    let res;
    try {
      res = await API.submitGuess(S.game.game_id, letters.join(''));
    } catch (e) {
      S.busy = false;
      shakeRow(); Sound.error(); toast(errMsg(e), e.code === 'NOT_IN_LIST' ? 'info' : 'error');
      if (e.code === 'GAME_OVER' || e.code === 'GAME_NOT_FOUND') goHome();
      return;
    }
    if (!S.game || S.over) return;                           // idle / quit while waiting
    if (res.reason === 'timeout') { return endWith(res); }    // server says time is over

    rowEl(S.row).classList.remove('current');
    await revealRow(S.row, res.result);
    updateKeys(letters, res.result);

    if (res.status === 'playing') {
      S.row++;
      S.cur = [];
      rowEl(S.row).classList.add('current');
      paintRow();
      renderAttempts();
      S.busy = false;
      return;
    }

    S.over = true;
    stopTimer();
    if (res.status === 'won') {
      S.row++;
      renderAttempts();
      Array.from(rowEl(S.row - 1).children).forEach((tile, i) => {
        tile.style.setProperty('--d', `${i * 100}ms`);
        tile.classList.add('win');
      });
      Sound.win();
      Confetti.burst();
      await sleep(1100);
    } else {
      Sound.lose();
      await sleep(500);
    }
    showResult(res);
  }

  /* ── hint ── */
  async function onHint() {
    if (!S.game || S.over || S.busy) return;
    Sound.tap();
    if (S.hint) { showHint(); return; }
    const ok = await ask(t('hint_title'), t('hint_text', { n: S.settings.hint_penalty }), t('hint'));
    if (!ok || !S.game || S.over) return;
    try {
      S.hint = await API.useHint(S.game.game_id);
      $('#btn-hint').classList.add('used');
      showHint();
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  function showHint() {
    const b = $('#hint-banner');
    const txt = (S.lang === 'ar' ? S.hint.hint_ar : S.hint.hint_en) || S.hint.hint_en || S.hint.hint_ar;
    b.innerHTML = `${SVG.bulb}<span><b>${esc(t('hint_label'))}:</b> ${esc(txt)}</span>`;
    b.hidden = false;
  }

  /* ── quit / timeout / idle ── */
  async function onQuit() {
    if (!S.game || S.over) return;
    Sound.tap();
    const ok = await ask(t('quit_title'), t('quit_text'), t('finish'));
    if (!ok || !S.game || S.over) return;
    await abort('quit');
  }

  async function abort(reason) {
    if (!S.game || S.over) return;
    S.over = true; S.busy = true;
    stopTimer();
    let res = { status: 'lost', reason, word: null, attempt: S.row, score: 0 };
    try { res = { ...res, ...(await API.endGame(S.game.game_id, reason)) }; } catch (e) { /* show result anyway */ }
    if (reason === 'idle') return;
    Sound.lose();
    showResult(res);
  }

  async function endWith(res) {
    S.over = true;
    stopTimer();
    Sound.lose();
    showResult(res);
  }

  /* ── countdown timer (only when switched on in Admin → Settings) ── */
  const CIRC = 2 * Math.PI * 20;
  function startTimer() {
    stopTimer();
    const tl = S.game && S.game.time_limit;
    const box = $('#g-timer');
    box.hidden = !tl;
    if (!tl) return;
    box.classList.remove('warn', 'mid');
    S.deadline = Date.now() + tl * 1000;
    S.lastTick = -1;
    tick();
    S.timer = setInterval(tick, 250);
  }
  function stopTimer() { clearInterval(S.timer); S.timer = null; }
  function tick() {
    if (!S.game || S.over) return stopTimer();
    const total = S.game.time_limit * 1000;
    const left = Math.max(0, S.deadline - Date.now());
    const secs = Math.ceil(left / 1000);
    $('#g-timer-prog').style.strokeDashoffset = String(CIRC * (1 - left / total));
    $('#g-timer-text').textContent = fmtTime(secs);
    const box = $('#g-timer');
    box.classList.toggle('mid', left <= total * 0.5 && left > 20000);
    box.classList.toggle('warn', left <= 20000);
    if (secs <= 10 && secs > 0 && secs !== S.lastTick) Sound.tick();
    S.lastTick = secs;
    if (left <= 0) { stopTimer(); abort('timeout'); }
  }

  /* ═══════════════════════ result ═══════════════════════ */
  function showResult(res) {
    clearInterval(S.autoclose);
    const won = res.status === 'won';
    const g = S.game || { max_attempts: S.settings.max_attempts, lang: S.lang };

    $('#r-icon').className = 'r-icon ' + (won ? 'win' : 'lose');
    $('#result-card').classList.toggle('win', won);
    $('#r-icon').innerHTML = won ? SVG.trophy : (res.reason === 'timeout' ? SVG.clock : SVG.flag);
    $('#r-title').textContent = won
      ? t('win_' + Math.min(res.attempt || 6, 6))
      : res.reason === 'timeout' ? t('lose_timeout') : res.reason === 'quit' ? t('lose_quit') : t('lose_title');
    $('#r-sub').textContent = won ? t('win_sub') : t('lose_sub');

    // answer tiles
    const wordRow = $('#r-word');
    wordRow.dir = g.lang === 'ar' ? 'rtl' : 'ltr';
    const letters = Array.from(res.word || '');
    const tiles = letters.map(ch => h('div', 'tile filled', display(ch, g.lang)));
    wordRow.replaceChildren(...tiles);
    wordRow.hidden = !letters.length;
    $('#r-sub').hidden = !letters.length;
    const tl = Math.min(4.6, 26 / Math.max(letters.length, 1));
    wordRow.style.setProperty('--tile', tl + 'rem');

    // score + breakdown
    $('#r-score-box').hidden = !won;
    $('#r-score').textContent = '0';
    const bd = $('#r-breakdown');
    bd.replaceChildren();
    if (won && res.detail) {
      const d = res.detail;
      [['score_base', d.base], ['score_speed', d.speed], ['score_length', d.length], ['score_hint', d.hint]]
        .filter(([k, v]) => k === 'score_base' || v)
        .forEach(([k, v], i) => {
          const row = h('div', 'bd-row');
          row.style.setProperty('--i', i);
          row.innerHTML = `<span>${esc(t(k))}</span><b class="${v < 0 ? 'neg' : i ? 'pos' : ''}">${v > 0 && i ? '+' : ''}${nf(v)}</b>`;
          bd.appendChild(row);
        });
    }

    $('#r-attempts').textContent = won ? `${res.attempt}/${res.max_attempts || g.max_attempts}` : `${res.attempt ?? S.row}/${g.max_attempts}`;
    $('#r-time').textContent = res.duration_ms != null ? fmtTime(res.duration_ms / 1000) : '–';
    $('#r-rank').textContent = res.rank ? `#${res.rank}` : '–';

    const pl = S.player && S.player.plays_left;
    $('#r-again').hidden = !(S.player && (pl == null || pl > 0));

    openOverlay($('#result'));
    tiles.forEach((tile, i) => flipTile(tile, won ? 'correct' : 'answer', 350 + i * 140, false));
    if (won) countUp($('#r-score'), res.score, 1300, 500);
    startAutoClose();
  }

  function countUp(el, to, dur, delay) {
    setTimeout(() => {
      const t0 = performance.now();
      const step = now => {
        const p = Math.min(1, (now - t0) / dur);
        el.textContent = nf(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay);
  }

  function startAutoClose() {
    const secs = S.settings.result_screen_seconds || 25;
    let left = secs;
    const bar = $('#r-bar');
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `transform ${secs}s linear`;
      bar.style.transform = 'scaleX(0)';
    }));
    const upd = () => { $('#r-count').textContent = t('auto_home', { n: left }); };
    upd();
    S.autoclose = setInterval(() => { left--; upd(); if (left <= 0) goHome(); }, 1000);
  }

  async function playAgain() {
    Sound.tap();
    clearInterval(S.autoclose);
    const btn = $('#r-again');
    btn.classList.add('loading');
    try {
      await beginGame();
      closeOverlay($('#result'));
    } catch (e) {
      toast(errMsg(e), 'error', 3200);
      goHome();
    } finally {
      btn.classList.remove('loading');
    }
  }

  /* ═══════════════════════ leaderboard ═══════════════════════ */
  function openBoard() { Sound.tap(); show('board'); loadBoard(); }

  async function loadBoard() {
    $$('#lb-tabs [data-period]').forEach(b => b.classList.toggle('active', b.dataset.period === S.lbPeriod));
    const pod = $('#podium'), list = $('#rank-list');
    list.innerHTML = '<li class="empty"><div class="spinner"></div></li>';
    try {
      const rows = await API.getLeaderboard(S.lbPeriod, Math.max(S.settings.leaderboard_size || 10, 3));
      renderPodium(rows.slice(0, 3));
      pod.hidden = !rows.length;
      list.replaceChildren(...(rows.length
        ? rows.slice(3).map((r, i) => champItem(r, i))
        : [h('li', 'empty', t('board_empty'))]));
    } catch (e) {
      pod.hidden = true;
      list.replaceChildren(h('li', 'empty', errMsg(e)));
    }
  }

  function renderPodium(top) {
    const order = [top[1], top[0], top[2]];
    $('#podium').replaceChildren(...order.map(r => {
      if (!r) return h('div', 'pod ghost');
      const d = h('div', `pod pod-${r.rank}`);
      d.innerHTML =
        `<div class="pod-avatar">${r.rank === 1 ? `<span class="pod-crown">${SVG.crown}</span>` : ''}${esc(initials(r.full_name))}<span class="pod-medal">${r.rank}</span></div>` +
        `<strong>${esc(r.full_name)}</strong>` +
        `<div class="pod-score">${nf(r.total_score)} <span>${esc(t('pts'))}</span></div>` +
        `<div class="pod-base"></div>`;
      return d;
    }));
  }

  /* ═══════════════════════ idle / kiosk ═══════════════════════ */
  function resetIdle() {
    clearTimeout(S.idle);
    if (S.screen === 'home') return;
    let secs = S.settings.idle_timeout_seconds || 90;
    if (S.screen === 'game') secs = Math.max(secs, 120, S.game && S.game.time_limit ? S.game.time_limit + 15 : 0);   // the timer ends timed games itself
    S.idle = setTimeout(onIdle, secs * 1000);
  }

  function onIdle() {
    if (!$('#result').hidden) return;              // result screen has its own countdown
    if (S.screen === 'game' && S.game && !S.over) abort('idle');
    goHome();
  }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        S.wake = await navigator.wakeLock.request('screen');
      }
    } catch (e) { /* not supported / denied */ }
  }

  function tryFullscreen() {
    if (!cfg.KIOSK_FULLSCREEN || document.fullscreenElement) return;
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn) { try { const p = fn.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
  }

  /* ═══════════════════════ events ═══════════════════════ */
  function bind() {
    $('#hero').addEventListener('click', openRegister);
    $('#btn-all-champions').addEventListener('click', openBoard);
    $('#reg-form').addEventListener('submit', onRegister);
    $('#btn-reg-back').addEventListener('click', () => { Sound.tap(); goHome(); });
    $('#in-id').addEventListener('input', e => {
      const v = e.target.value.replace(/\D/g, '');
      if (v !== e.target.value) e.target.value = v;
    });
    $('#in-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('#in-id').focus(); }
    });
    ['in-name', 'in-id'].forEach(id => $('#' + id).addEventListener('input', () => {
      $('#' + (id === 'in-name' ? 'f-name' : 'f-id')).classList.remove('invalid');
    }));

    // on-screen keyboard — tuned for touch:
    //  • reacts on touch-down (no delay)
    //  • a tap that lands in the gap between keys goes to the nearest key
    //  • a bubble above the finger shows which letter was typed
    const kb = $('#keyboard');
    const pop = h('div', 'key-pop');
    document.body.appendChild(pop);
    let popTimer = null;
    const keyAt = (x, y) => {
      let best = null, bd = Infinity;
      for (const k of kb.querySelectorAll('.key')) {
        const r = k.getBoundingClientRect();
        const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    };
    const showPop = key => {
      const r = key.getBoundingClientRect();
      pop.textContent = key.textContent;
      pop.style.left = (r.left + r.width / 2) + 'px';
      pop.style.top = (r.top - 6) + 'px';
      pop.classList.add('show');
      clearTimeout(popTimer);
      popTimer = setTimeout(() => pop.classList.remove('show'), 190);
    };
    kb.addEventListener('pointerdown', e => {
      const key = e.target.closest('.key') || keyAt(e.clientX, e.clientY);
      if (!key) return;
      e.preventDefault();
      key.classList.add('down');
      setTimeout(() => key.classList.remove('down'), 150);
      const k = key.dataset.key;
      if (k.length === 1 && !S.busy && !S.over && S.game && S.cur.length < S.game.length) showPop(key);
      const touched = !navigator.userActivation || navigator.userActivation.hasBeenActive;
      if (navigator.vibrate && touched) { try { navigator.vibrate(8); } catch (err) { /* not supported */ } }
      onKey(k);
    });

    $('#btn-hint').addEventListener('click', onHint);
    $('#g-image').addEventListener('click', openLightbox);
    $('#g-image').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(); } });
    $('#lightbox').addEventListener('click', () => { Sound.tap(); closeOverlay($('#lightbox')); });
    $('#btn-quit').addEventListener('click', onQuit);
    $('#r-again').addEventListener('click', playAgain);
    $('#r-finish').addEventListener('click', () => { Sound.tap(); goHome(); });
    $('#btn-board-back').addEventListener('click', () => { Sound.tap(); show('home'); });
    $('#lb-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-period]');
      if (!b || b.dataset.period === S.lbPeriod) return;
      Sound.tap();
      S.lbPeriod = b.dataset.period;
      loadBoard();
    });

    // physical keyboard (handy for testing on a PC)
    document.addEventListener('keydown', e => {
      if (S.screen !== 'game' || !S.game || !$('#confirm').hidden || !$('#result').hidden) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') { e.preventDefault(); onKey('enter'); return; }
      if (e.key === 'Backspace') { e.preventDefault(); onKey('back'); return; }
      const ch = U.normalize(e.key);
      if (ch.length === 1 && U.isLetter(ch, S.game.lang)) onKey(ch);
    });

    // kiosk hardening
    document.addEventListener('pointerdown', () => { resetIdle(); Sound.unlock(); tryFullscreen(); }, { passive: true });
    document.addEventListener('keydown', resetIdle, { passive: true });
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('dblclick', e => e.preventDefault());
    document.addEventListener('visibilitychange', keepAwake);
  }

  /* ═══════════════════════ boot ═══════════════════════ */
  async function boot() {
    $('#brand-logo').src = cfg.LOGO_URL || 'assets/logo.svg';
    $('#demo-badge').hidden = API.mode !== 'demo';
    I18N.set(S.lang);
    bind();
    renderStatic();
    show('home');
    buildAmbient();
    keepAwake();
    try {
      S.settings = { ...S.settings, ...(await API.getSettings()) };
    } catch (e) {
      toast(t('err_network'), 'error', 4000);
    }
    Sound.enabled = !!S.settings.sound_enabled;
    renderStatic();
    loadHomeChampions();
  }

  boot();
})();
