/* ─────────────────────────────────────────────────────────────────────────
   PAM Word Challenge — data layer
   One API, two backends:
     • Supabase  (production)  — game logic runs in SQL, answer never leaves the server
     • Demo      (no keys set) — same behaviour, stored in localStorage
   ───────────────────────────────────────────────────────────────────────── */
window.API = (() => {
  'use strict';
  const cfg = window.APP_CONFIG || {};

  const DEFAULT_SETTINGS = {
    event_title_en: 'PAM Word Challenge',
    event_title_ar: 'تحدي الكلمات',
    max_attempts: 6,
    timer_enabled: false,
    time_limit_seconds: 120,
    plays_per_day: 3,
    word_lang_mode: 'ar',
    hints_enabled: true,
    hint_penalty: 150,
    require_known_words: true,
    idle_timeout_seconds: 90,
    result_screen_seconds: 25,
    leaderboard_size: 10,
    show_leaderboard: true,
    sound_enabled: true,
    id_min_length: 4,
    id_max_length: 12,
    timezone: 'Asia/Kuwait',
    season_name: 'Season 1',
    season_start: null
  };

  /* ── shared helpers (must match SQL) ─────────────────────────────────── */
  const AR_LETTER = /^[ء-ي]$/;
  const util = {
    normalize(s) {
      return String(s ?? '')
        .toLowerCase()
        .replace(/[\sً-ٰٟـ]/g, '')
        .replace(/[أإآٱ]/g, 'ا');
    },
    chars: w => Array.from(String(w ?? '')),
    isLetter(ch, lang) { return lang === 'ar' ? AR_LETTER.test(ch) : /^[a-z]$/.test(ch); },
    isWord(w, lang) {
      const c = Array.from(w || '');
      return c.length >= 3 && c.length <= 8 && c.every(ch => util.isLetter(ch, lang));
    },
    detectLang: w => (/[؀-ۿ]/.test(w) ? 'ar' : 'en'),
    evaluate(guess, answer) {
      const g = Array.from(guess), a = Array.from(answer);
      const res = a.map(() => 'absent'), used = a.map(() => false);
      g.forEach((ch, i) => { if (ch === a[i]) { res[i] = 'correct'; used[i] = true; } });
      g.forEach((ch, i) => {
        if (res[i] === 'correct') return;
        const j = a.findIndex((x, k) => !used[k] && x === ch);
        if (j > -1) { res[i] = 'present'; used[j] = true; }
      });
      return res;
    },
    score({ attempt, elapsed, timeLimit, len, hintUsed, hintPenalty }) {
      const base = Math.max(200, 1000 - (attempt - 1) * 150);
      const speed = timeLimit > 0
        ? Math.round(300 * Math.max(0, timeLimit - elapsed) / timeLimit)
        : Math.max(0, 300 - Math.floor(elapsed));
      const length = Math.max(0, (len - 5) * 100);
      const hint = hintUsed ? -hintPenalty : 0;
      return { base, speed, length, hint, total: Math.max(50, base + speed + length + hint) };
    },
    mask: id => '••••' + String(id).slice(-4)
  };

  function makeErr(code, cause) {
    const e = new Error(code);
    e.code = code;
    if (cause) e.cause = cause;
    return e;
  }
  const fail = code => { throw makeErr(code); };

  /* ═════════════════════════════════════════════════════════════════════
     SUPABASE BACKEND
     ═════════════════════════════════════════════════════════════════════ */
  function createSupabase() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pamwc-admin-auth' }
    });
    const KNOWN = /^[A-Z_]{3,40}$/;

    function wrap(error) {
      const msg = (error && error.message) || '';
      if (error && error.code === '23505') return makeErr('DUPLICATE', error);
      if (error && (error.code === 'PGRST202' || error.code === 'PGRST204' || /Could not find the/i.test(msg))) return makeErr('NEEDS_UPDATE', error);
      if (KNOWN.test(msg)) return makeErr(msg, error);
      if (/fetch|network|Failed to/i.test(msg)) return makeErr('NETWORK', error);
      if (/JWT|permission denied|row-level security/i.test(msg)) return makeErr('FORBIDDEN', error);
      return makeErr('GENERIC', error);
    }
    async function rpc(fn, args) {
      let r;
      try { r = await sb.rpc(fn, args); } catch (e) { throw makeErr('NETWORK', e); }
      if (r.error) throw wrap(r.error);
      return r.data;
    }
    async function q(builder) {
      let r;
      try { r = await builder; } catch (e) { throw makeErr('NETWORK', e); }
      if (r.error) throw wrap(r.error);
      return r.data;
    }

    return {
      getSettings: () => rpc('get_public_settings'),
      registerPlayer: (name, id) => rpc('register_player', { p_full_name: name, p_id_number: id }),
      startGame: (pid, lang) => rpc('start_game', { p_player_id: pid, p_lang: lang }),
      submitGuess: (gid, guess) => rpc('submit_guess', { p_game_id: gid, p_guess: guess }),
      useHint: gid => rpc('use_hint', { p_game_id: gid }),
      endGame: (gid, reason) => rpc('end_game', { p_game_id: gid, p_reason: reason }),
      getLeaderboard: (period, limit, pid) =>
        rpc('get_leaderboard', { p_period: period, p_limit: limit, p_player_id: pid || null }),

      auth: {
        async signIn(email, password) {
          let r;
          try { r = await sb.auth.signInWithPassword({ email, password }); } catch (e) { throw makeErr('NETWORK', e); }
          if (r.error) throw makeErr(/fetch/i.test(r.error.message) ? 'NETWORK' : 'BAD_LOGIN', r.error);
          const ok = await rpc('is_admin');
          if (!ok) { await sb.auth.signOut(); throw makeErr('NOT_ADMIN'); }
          return r.data.user;
        },
        async session() {
          const { data } = await sb.auth.getSession();
          if (!data.session) return null;
          try { if (await rpc('is_admin')) return data.session.user; } catch (e) { /* ignore */ }
          return null;
        },
        signOut: () => sb.auth.signOut()
      },

      admin: {
        stats: () => rpc('admin_stats'),
        async listWords() {
          const rows = await q(sb.from('words')
            .select('id, word, lang, hint_en, hint_ar, category_id, image_url, active, created_at, games(count)')
            .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(5000));
          return rows.map(r => ({ ...r, plays: (r.games && r.games[0] && r.games[0].count) || 0 }));
        },
        async addWords(rows) {
          if (!rows.length) return { inserted: 0, skipped: 0 };
          const data = await q(sb.from('words')
            .upsert(rows, { onConflict: 'word,lang', ignoreDuplicates: true }).select('id'));
          return { inserted: data.length, skipped: rows.length - data.length };
        },
        updateWord: (id, patch) => q(sb.from('words').update(patch).eq('id', id).select().single()),
        deleteWord: id => q(sb.from('words').delete().eq('id', id)),

        /* word images (Supabase Storage, bucket "word-images") */
        async uploadWordImage(blob) {
          const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
          const rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
          const path = `${rnd}.${ext}`;                 // random name: never reveals the word
          let r;
          try { r = await sb.storage.from('word-images').upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }); }
          catch (e) { throw makeErr('NETWORK', e); }
          if (r.error) throw makeErr('IMAGE_UPLOAD', r.error);
          return sb.storage.from('word-images').getPublicUrl(path).data.publicUrl;
        },
        async deleteWordImage(url) {
          const m = String(url || '').match(/\/word-images\/([^?#]+)/);
          if (!m) return;
          try { await sb.storage.from('word-images').remove([decodeURIComponent(m[1])]); } catch (e) { /* best effort */ }
        },
        getSettings: () => q(sb.from('app_settings').select('*').eq('id', 1).single()),
        saveSettings: patch => q(sb.from('app_settings')
          .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select().single()),
        listGames: (limit = 1000) => q(sb.from('games')
          .select('id, status, end_reason, answer, lang, guesses, max_attempts, score, hint_used, started_at, finished_at, duration_ms, players(full_name, id_number)')
          .order('started_at', { ascending: false }).limit(limit)),
        deleteGame: id => q(sb.from('games').delete().eq('id', id)),
        leaderboard: (period, limit) =>
          rpc('get_leaderboard', { p_period: period, p_limit: limit, p_player_id: null }),
        newSeason: name => rpc('admin_new_season', { p_name: name || null }),
        deleteDay: (day, dryRun) => rpc('admin_delete_day', { p_day: day, p_dry_run: !!dryRun }),

        /* categories */
        async listCategories() {
          const rows = await q(sb.from('categories').select('id, name_en, name_ar, created_at, words(count)').order('id'));
          return rows.map(r => ({ ...r, words: (r.words && r.words[0] && r.words[0].count) || 0 }));
        },
        addCategory: c => q(sb.from('categories').insert(c).select().single()),
        updateCategory: (id, c) => q(sb.from('categories').update(c).eq('id', id).select().single()),
        deleteCategory: id => q(sb.from('categories').delete().eq('id', id)),

        /* dictionary */
        async dictCounts() {
          const one = async lang => {
            let r;
            try { r = await sb.from('dictionary').select('word', { count: 'exact', head: true }).eq('lang', lang); }
            catch (e) { throw makeErr('NETWORK', e); }
            if (r.error) throw wrap(r.error);
            return r.count || 0;
          };
          const [en, ar] = await Promise.all([one('en'), one('ar')]);
          return { en, ar };
        },
        async importDictionary(lang, words, onProgress) {
          const B = 1000;
          for (let i = 0; i < words.length; i += B) {
            const batch = words.slice(i, i + B).map(word => ({ lang, word }));
            await q(sb.from('dictionary').upsert(batch, { onConflict: 'lang,word', ignoreDuplicates: true }));
            if (onProgress) onProgress(Math.min(i + B, words.length), words.length);
          }
        },
        clearDictionary: lang => q(sb.from('dictionary').delete().eq('lang', lang)),
        async checkWord(word, lang) {
          const [d, w] = await Promise.all([
            q(sb.from('dictionary').select('word').eq('lang', lang).eq('word', word).limit(1)),
            q(sb.from('words').select('id').eq('lang', lang).eq('word', word).limit(1))
          ]);
          return { dictionary: d.length > 0, answers: w.length > 0 };
        }
      }
    };
  }

  /* ═════════════════════════════════════════════════════════════════════
     DEMO BACKEND (localStorage) — mirrors the SQL functions
     ═════════════════════════════════════════════════════════════════════ */
  const SEED = [
    ['cloud', 'en', 'Online storage and computing', 'تخزين وحوسبة عبر الإنترنت', 1],
    ['linux', 'en', 'Open-source operating system', 'نظام تشغيل مفتوح المصدر', 3],
    ['cache', 'en', 'Fast temporary storage', 'ذاكرة تخزين مؤقت سريعة', 5],
    ['pixel', 'en', 'Smallest dot on a screen', 'أصغر نقطة في الشاشة', 5],
    ['debug', 'en', 'Find and fix code errors', 'البحث عن أخطاء البرمجة وإصلاحها', 3],
    ['login', 'en', 'Sign in to a system', 'الدخول إلى النظام', 1],
    ['token', 'en', 'Digital key for authentication', 'مفتاح رقمي للمصادقة', 4],
    ['query', 'en', 'Request sent to a database', 'طلب يُرسل إلى قاعدة البيانات', 3],
    ['proxy', 'en', 'A server in the middle', 'خادم وسيط', 2],
    ['cyber', 'en', 'Related to computers and networks', 'متعلق بالحواسيب والشبكات', 4],
    ['server', 'en', 'Computer that serves others', 'حاسوب يقدم الخدمات لغيره', 2],
    ['python', 'en', 'Popular programming language', 'لغة برمجة شهيرة', 3],
    ['router', 'en', 'Directs network traffic', 'يوجّه حركة الشبكة', 2],
    ['wifi', 'en', 'Wireless network', 'شبكة لاسلكية', 2],
    ['شبكة', 'ar', 'Network', 'مجموعة أجهزة متصلة ببعضها', 2],
    ['حاسوب', 'ar', 'Computer', 'جهاز لمعالجة البيانات', 5],
    ['برمجة', 'ar', 'Programming', 'كتابة الأوامر للحاسوب', 3],
    ['خادم', 'ar', 'Server', 'حاسوب يقدم الخدمات', 2],
    ['بيانات', 'ar', 'Data', 'معلومات مخزنة', 6],
    ['تشفير', 'ar', 'Encryption', 'حماية البيانات بتحويلها إلى رموز', 4],
    ['سحابة', 'ar', 'Cloud', 'تخزين عبر الإنترنت', 1],
    ['أمان', 'ar', 'Security', 'حماية الأنظمة من الاختراق', 4],
    ['تقنية', 'ar', 'Technology', 'استخدام العلم في حل المشكلات', 6],
    ['متصفح', 'ar', 'Browser', 'برنامج لتصفح الإنترنت', 1],
    ['تطبيق', 'ar', 'Application', 'برنامج على الهاتف', 3],
    ['طابعة', 'ar', 'Printer', 'تحوّل الملف إلى ورق', 5]
  ];

  const SEED_CATS = [
    [1, 'Internet & Cloud', 'الإنترنت والسحابة'],
    [2, 'Networks', 'الشبكات'],
    [3, 'Programming', 'البرمجة'],
    [4, 'Cyber Security', 'الأمن السيبراني'],
    [5, 'Hardware', 'الأجهزة'],
    [6, 'General Tech', 'تقنية عامة']
  ];

  function createDemo() {
    const KEY = 'pamwc_demo_v1', SKEY = 'pamwc_demo_admin', DKEY = 'pamwc_demo_dict';
    const nowIso = () => new Date().toISOString();
    const uid = () => (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    const wait = (v, ms = 110) => new Promise(r => setTimeout(() => r(v), ms));

    const fresh = () => ({
      v: 1,
      seq: SEED.length + 1,
      settings: { ...DEFAULT_SETTINGS, season_start: nowIso() },
      words: SEED.map((s, i) => ({
        id: i + 1, word: util.normalize(s[0]), lang: s[1],
        hint_en: s[2] || null, hint_ar: s[3] || null, category_id: s[4] || null, active: true, created_at: nowIso()
      })),
      catSeq: SEED_CATS.length + 1,
      categories: SEED_CATS.map(([id, en, ar]) => ({ id, name_en: en, name_ar: ar, created_at: nowIso() })),
      players: [],
      games: []
    });
    const load = () => {
      try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.v === 1) return d; } catch (e) { /* ignore */ }
      return fresh();
    };
    let db = load();
    if (!db.categories) {                         // upgrade an older demo database
      db.categories = SEED_CATS.map(([id, en, ar]) => ({ id, name_en: en, name_ar: ar, created_at: nowIso() }));
      db.catSeq = SEED_CATS.length + 1;
      const map = new Map(SEED.map(x => [util.normalize(x[0]) + ':' + x[1], x[4]]));
      db.words.forEach(w => { if (w.category_id == null) w.category_id = map.get(w.word + ':' + w.lang) || null; });
    }
    if (db.settings.timer_enabled === undefined) { db.settings.timer_enabled = false; db.settings.time_limit_seconds = 120; }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } };

    // dictionary lives in its own key (can be ~1 MB)
    const loadDict = () => {
      try { const d = JSON.parse(localStorage.getItem(DKEY)) || {}; return { en: new Set(d.en || []), ar: new Set(d.ar || []) }; }
      catch (e) { return { en: new Set(), ar: new Set() }; }
    };
    let dict = loadDict();
    const saveDict = () => {
      try { localStorage.setItem(DKEY, JSON.stringify({ en: [...dict.en], ar: [...dict.ar] })); }
      catch (e) { throw makeErr('STORAGE_FULL'); }
    };
    save();
    window.addEventListener('storage', e => { if (e.key === KEY) db = load(); if (e.key === DKEY) dict = loadDict(); });

    const S = () => db.settings;
    const day = iso => {
      try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: S().timezone || 'Asia/Kuwait' }); }
      catch (e) { return String(iso).slice(0, 10); }
    };
    const playsToday = pid => { const d = day(nowIso()); return db.games.filter(g => g.player_id === pid && day(g.started_at) === d).length; };
    const findGame = id => db.games.find(g => g.id === id) || fail('GAME_NOT_FOUND');
    const wordCounts = () => ({
      words_en: db.words.filter(w => w.active && w.lang === 'en').length,
      words_ar: db.words.filter(w => w.active && w.lang === 'ar').length
    });
    const finishGame = (g, status, reason) => {
      g.status = status; g.end_reason = reason; g.finished_at = nowIso();
      g.duration_ms = Date.now() - new Date(g.started_at).getTime();
    };

    function board(period, limit, pid, admin) {
      const s = S();
      const seasonStart = new Date(s.season_start || 0).getTime();
      const today = day(nowIso());
      const weekAgo = Date.now() - 7 * 864e5;
      const pmap = new Map(db.players.map(p => [p.id, p]));
      const agg = new Map();
      for (const g of db.games) {
        if (g.status !== 'won' && g.status !== 'lost') continue;
        const ts = new Date(g.started_at).getTime();
        if (period !== 'all' && ts < seasonStart) continue;
        if (period === 'today' && day(g.started_at) !== today) continue;
        if (period === 'week' && ts < weekAgo) continue;
        const p = pmap.get(g.player_id); if (!p) continue;
        const a = agg.get(p.id) || { id: p.id, full_name: p.full_name, id_number: p.id_number, total_score: 0, wins: 0, games: 0, best_time_ms: null };
        a.total_score += g.score; a.games++;
        if (g.status === 'won') { a.wins++; if (a.best_time_ms == null || g.duration_ms < a.best_time_ms) a.best_time_ms = g.duration_ms; }
        agg.set(p.id, a);
      }
      const rows = [...agg.values()].filter(a => a.total_score > 0).sort((a, b) =>
        b.total_score - a.total_score || b.wins - a.wins ||
        (a.best_time_ms ?? 1e15) - (b.best_time_ms ?? 1e15) || a.games - b.games ||
        a.full_name.localeCompare(b.full_name));
      const cap = Math.min(Math.max(limit || 10, 1), 500);
      return rows.map((a, i) => ({
        rank: i + 1, full_name: a.full_name,
        id_display: admin ? a.id_number : null,         // players never see ID numbers
        total_score: a.total_score, wins: a.wins, games: a.games, best_time_ms: a.best_time_ms,
        is_me: !!pid && a.id === pid
      })).filter(r => r.rank <= cap || r.is_me);
    }
    const rankOf = pid => { const r = board('season', 1, pid).find(x => x.is_me); return r ? r.rank : null; };

    return {
      async getSettings() { return wait({ ...S(), ...wordCounts() }, 60); },

      async registerPlayer(name, idn) {
        const s = S();
        const n = String(name || '').trim().replace(/\s+/g, ' ');
        const id = String(idn || '').replace(/\D/g, '');
        if (Array.from(n).length < 3 || Array.from(n).length > 80) fail('INVALID_NAME');
        if (id.length < s.id_min_length || id.length > s.id_max_length) fail('INVALID_ID');
        let p = db.players.find(x => x.id_number === id);
        if (p) { p.full_name = n; p.last_seen_at = nowIso(); }
        else { p = { id: uid(), full_name: n, id_number: id, created_at: nowIso(), last_seen_at: nowIso() }; db.players.push(p); }
        save();
        const pt = playsToday(p.id);
        return wait({ player_id: p.id, full_name: p.full_name, plays_today: pt,
          plays_left: s.plays_per_day > 0 ? Math.max(0, s.plays_per_day - pt) : null });
      },

      async startGame(pid, lang) {
        const s = S();
        if (!db.players.some(p => p.id === pid)) fail('PLAYER_NOT_FOUND');
        const L = ['en', 'ar'].includes(s.word_lang_mode) ? s.word_lang_mode : (lang === 'en' ? 'en' : 'ar');
        db.games.filter(g => g.player_id === pid && g.status === 'playing').forEach(g => finishGame(g, 'abandoned', 'replaced'));
        const pt = playsToday(pid);
        if (s.plays_per_day > 0 && pt >= s.plays_per_day) { save(); fail('DAILY_LIMIT'); }
        const pool = db.words.filter(w => w.active && w.lang === L);
        if (!pool.length) { save(); fail('NO_WORDS'); }
        // fair shuffle — same rules as start_game() in schema.sql:
        // unseen by this player → not one of the last few served → least served → random
        const recentN = Math.min(3, pool.length - 1);
        const recent = new Set(db.games
          .filter(g => g.lang === L && g.word_id != null)
          .sort((a, b) => b.started_at.localeCompare(a.started_at))
          .slice(0, recentN).map(g => g.word_id));
        const served = {}, seen = new Set();
        db.games.forEach(g => {
          if (g.word_id == null) return;
          served[g.word_id] = (served[g.word_id] || 0) + 1;
          if (g.player_id === pid) seen.add(g.word_id);
        });
        const w = pool
          .map(x => ({ x, a: seen.has(x.id) ? 1 : 0, b: recent.has(x.id) ? 1 : 0, c: served[x.id] || 0, r: Math.random() }))
          .sort((p, q) => p.a - q.a || p.b - q.b || p.c - q.c || p.r - q.r)[0].x;
        const g = {
          id: uid(), player_id: pid, word_id: w.id, answer: w.word, lang: L, status: 'playing', end_reason: null,
          guesses: [], max_attempts: s.max_attempts, time_limit: s.timer_enabled ? Math.max(10, s.time_limit_seconds) : 0, hint_used: false,
          score: 0, score_detail: null, started_at: nowIso(), finished_at: null, duration_ms: null
        };
        db.games.push(g); save();
        const cat = db.categories.find(c => c.id === w.category_id) || {};
        return wait({
          game_id: g.id, length: Array.from(w.word).length, lang: L, max_attempts: g.max_attempts,
          category_en: cat.name_en || null, category_ar: cat.name_ar || null,
          image_url: w.image_url || null,
          time_limit: g.time_limit, has_hint: s.hints_enabled && !!(w.hint_en || w.hint_ar),
          plays_left: s.plays_per_day > 0 ? Math.max(0, s.plays_per_day - pt - 1) : null
        });
      },

      async submitGuess(gid, raw) {
        const g = findGame(gid), s = S();
        if (g.status !== 'playing') fail('GAME_OVER');
        const guess = util.normalize(raw);
        const len = Array.from(g.answer).length;
        const elapsed = (Date.now() - new Date(g.started_at).getTime()) / 1000;
        if (g.time_limit > 0 && elapsed > g.time_limit + 5) {
          finishGame(g, 'lost', 'timeout'); save();
          return wait({ status: 'lost', reason: 'timeout', word: g.answer, attempt: g.guesses.length, score: 0, duration_ms: g.duration_ms });
        }
        if (Array.from(guess).length !== len) fail('INVALID_LENGTH');
        if (!Array.from(guess).every(c => util.isLetter(c, g.lang))) fail('INVALID_CHARS');
        if (s.require_known_words && guess !== g.answer && !dict[g.lang].has(guess) &&
          !db.words.some(w => w.word === guess && w.lang === g.lang)) fail('NOT_IN_LIST');
        const result = util.evaluate(guess, g.answer);
        g.guesses.push(guess);
        const attempt = g.guesses.length;
        const status = guess === g.answer ? 'won' : attempt >= g.max_attempts ? 'lost' : 'playing';
        let detail = null, score = 0;
        if (status === 'won') {
          detail = util.score({ attempt, elapsed, timeLimit: g.time_limit, len, hintUsed: g.hint_used, hintPenalty: s.hint_penalty });
          score = detail.total;
        }
        g.score = score; g.score_detail = detail;
        if (status !== 'playing') finishGame(g, status, status === 'won' ? 'solved' : 'attempts');
        save();
        return wait({
          result, status, attempt, max_attempts: g.max_attempts, score, detail,
          word: status !== 'playing' ? g.answer : null,
          rank: status === 'won' ? rankOf(g.player_id) : null,
          duration_ms: status !== 'playing' ? g.duration_ms : null
        }, 160);
      },

      async useHint(gid) {
        const g = findGame(gid), s = S();
        if (g.status !== 'playing') fail('GAME_OVER');
        if (!s.hints_enabled) fail('HINTS_DISABLED');
        const w = db.words.find(x => x.id === g.word_id) || {};
        g.hint_used = true; save();
        return wait({ hint_en: w.hint_en || w.hint_ar || '', hint_ar: w.hint_ar || w.hint_en || '', penalty: s.hint_penalty });
      },

      async endGame(gid, reason) {
        const g = findGame(gid);
        const r = ['timeout', 'quit', 'idle'].includes(reason) ? reason : 'quit';
        if (g.status === 'playing') { finishGame(g, r === 'idle' ? 'abandoned' : 'lost', r); save(); }
        return wait({ status: g.status, reason: g.end_reason, word: g.answer, attempt: g.guesses.length, duration_ms: g.duration_ms, score: g.score });
      },

      async getLeaderboard(period, limit, pid) { return wait(board(period, limit, pid, false), 80); },

      auth: {
        async signIn(email, password) {
          if (!email || !password) fail('BAD_LOGIN');
          const user = { email };
          try { sessionStorage.setItem(SKEY, JSON.stringify(user)); } catch (e) { /* ignore */ }
          return wait(user, 300);
        },
        async session() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } },
        async signOut() { try { sessionStorage.removeItem(SKEY); } catch (e) { /* ignore */ } }
      },

      admin: {
        async stats() {
          const s = S();
          const ss = new Date(s.season_start || 0).getTime();
          const season = db.games.filter(g => new Date(g.started_at).getTime() >= ss);
          const fin = season.filter(g => g.status === 'won' || g.status === 'lost');
          const won = season.filter(g => g.status === 'won');
          const today = day(nowIso());
          const cutoff = Date.now() - 14 * 864e5;
          const daily = {};
          db.games.forEach(g => {
            if (new Date(g.started_at).getTime() < cutoff) return;
            const d = day(g.started_at);
            daily[d] = daily[d] || { day: d, games: 0, wins: 0 };
            daily[d].games++; if (g.status === 'won') daily[d].wins++;
          });
          return wait({
            players: db.players.length,
            players_season: new Set(season.map(g => g.player_id)).size,
            games_today: db.games.filter(g => day(g.started_at) === today).length,
            games_season: fin.length,
            wins_season: won.length,
            avg_score: won.length ? Math.round(won.reduce((a, g) => a + g.score, 0) / won.length) : 0,
            avg_attempts: won.length ? +(won.reduce((a, g) => a + g.guesses.length, 0) / won.length).toFixed(2) : 0,
            ...wordCounts(),
            words_total: db.words.length,
            season_name: s.season_name, season_start: s.season_start,
            daily: Object.values(daily)
          });
        },
        async listWords() {
          const counts = {};
          db.games.forEach(g => { counts[g.word_id] = (counts[g.word_id] || 0) + 1; });
          return wait(db.words.slice()
            .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
            .map(w => ({ ...w, plays: counts[w.id] || 0 })));
        },
        async addWords(rows) {
          let inserted = 0;
          rows.forEach(r => {
            const word = util.normalize(r.word);
            if (!util.isWord(word, r.lang)) return;
            if (db.words.some(w => w.word === word && w.lang === r.lang)) return;
            db.words.push({ id: db.seq++, word, lang: r.lang, hint_en: r.hint_en || null, hint_ar: r.hint_ar || null, category_id: r.category_id || null, active: r.active === true, created_at: nowIso() });
            inserted++;
          });
          save();
          return wait({ inserted, skipped: rows.length - inserted });
        },
        async updateWord(id, patch) {
          const w = db.words.find(x => x.id === id) || fail('NOT_FOUND');
          const next = { ...w, ...patch };
          next.word = util.normalize(next.word);
          if (!util.isWord(next.word, next.lang)) fail(next.lang === 'ar' ? 'INVALID_WORD_AR' : 'INVALID_WORD_EN');
          if (db.words.some(x => x.id !== id && x.word === next.word && x.lang === next.lang)) fail('DUPLICATE');
          next.hint_en = (next.hint_en || '').trim() || null;
          next.hint_ar = (next.hint_ar || '').trim() || null;
          Object.assign(w, next); save();
          return wait({ ...w });
        },
        async deleteWord(id) {
          db.words = db.words.filter(w => w.id !== id);
          db.games.forEach(g => { if (g.word_id === id) g.word_id = null; });
          save(); return wait(true);
        },
        async uploadWordImage(blob) {
          return new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = () => rej(makeErr('IMAGE_UPLOAD'));
            fr.readAsDataURL(blob);
          });
        },
        async deleteWordImage() { return true; },
        async deleteDay(dayStr, dryRun) {
          const hits = db.games.filter(g => day(g.started_at) === dayStr);
          const res = { day: dayStr, games: hits.length, players: new Set(hits.map(g => g.player_id)).size, deleted: !dryRun };
          if (!dryRun && hits.length) { db.games = db.games.filter(g => day(g.started_at) !== dayStr); save(); }
          return wait(res);
        },
        async getSettings() { return wait({ ...S() }); },
        async saveSettings(patch) { Object.assign(db.settings, patch, { updated_at: nowIso() }); save(); return wait({ ...S() }); },
        async listGames(limit = 1000) {
          const pmap = new Map(db.players.map(p => [p.id, p]));
          return wait(db.games.slice()
            .sort((a, b) => b.started_at.localeCompare(a.started_at))
            .slice(0, limit)
            .map(g => {
              const p = pmap.get(g.player_id);
              return { ...g, players: p ? { full_name: p.full_name, id_number: p.id_number } : null };
            }));
        },
        async deleteGame(id) { db.games = db.games.filter(g => g.id !== id); save(); return wait(true); },
        async leaderboard(period, limit) { return wait(board(period, limit, null, true)); },
        async newSeason(name) {
          db.settings.season_start = nowIso();
          if (name && name.trim()) db.settings.season_name = name.trim();
          save(); return wait({ ...S() });
        },

        async listCategories() {
          return wait(db.categories.map(c => ({ ...c, words: db.words.filter(w => w.category_id === c.id).length })));
        },
        async addCategory(c) {
          if (db.categories.some(x => x.name_en.toLowerCase() === c.name_en.toLowerCase())) fail('DUPLICATE');
          const row = { id: db.catSeq++, name_en: c.name_en, name_ar: c.name_ar, created_at: nowIso() };
          db.categories.push(row); save(); return wait({ ...row });
        },
        async updateCategory(id, c) {
          const row = db.categories.find(x => x.id === id) || fail('NOT_FOUND');
          if (db.categories.some(x => x.id !== id && x.name_en.toLowerCase() === c.name_en.toLowerCase())) fail('DUPLICATE');
          Object.assign(row, c); save(); return wait({ ...row });
        },
        async deleteCategory(id) {
          db.categories = db.categories.filter(c => c.id !== id);
          db.words.forEach(w => { if (w.category_id === id) w.category_id = null; });
          save(); return wait(true);
        },

        async dictCounts() { return wait({ en: dict.en.size, ar: dict.ar.size }); },
        async importDictionary(lang, words, onProgress) {
          const B = 5000;
          for (let i = 0; i < words.length; i += B) {
            words.slice(i, i + B).forEach(w => { const n = util.normalize(w); if (util.isWord(n, lang)) dict[lang].add(n); });
            if (onProgress) onProgress(Math.min(i + B, words.length), words.length);
            await wait(null, 10);
          }
          saveDict();
        },
        async clearDictionary(lang) { dict[lang] = new Set(); saveDict(); return wait(true); },
        async checkWord(word, lang) {
          return wait({ dictionary: dict[lang].has(word), answers: db.words.some(w => w.word === word && w.lang === lang) });
        }
      }
    };
  }

  /* ── pick backend ────────────────────────────────────────────────────── */
  // add ?demo=1 to the address to try the game on local data without touching the real database
  const forceDemo = /[?&]demo=1\b/.test(location.search);
  const hasSupabase = !forceDemo && !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !/YOUR_/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY) && window.supabase);
  const backend = hasSupabase ? createSupabase() : createDemo();

  return { mode: hasSupabase ? 'supabase' : 'demo', util, DEFAULT_SETTINGS, ...backend };
})();
