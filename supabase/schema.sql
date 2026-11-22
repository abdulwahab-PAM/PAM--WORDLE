-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  PAM Word Challenge · تحدي الكلمات                                       ║
-- ║  Public Authority of Manpower — Information Technology Department      ║
-- ║                                                                        ║
-- ║  HOW TO USE                                                            ║
-- ║  1. Supabase Dashboard → SQL Editor → New query                         ║
-- ║  2. Paste this whole file → Run                                        ║
-- ║  3. Authentication → Users → Add user (your admin email + password)    ║
-- ║  4. Run the "MAKE ME ADMIN" statement at the very bottom               ║
-- ║                                                                        ║
-- ║  Security model                                                        ║
-- ║  • The kiosk uses the public anon key and can ONLY call the game RPCs  ║
-- ║    below. It can never read the words table, so the answer is never   ║
-- ║    sent to the browser until the game is over.                         ║
-- ║  • Guesses are checked and scored on the server (no cheating).         ║
-- ║  • Admins sign in with Supabase Auth; tables are protected by RLS.     ║
-- ║                                                                        ║
-- ║  Safe to re-run (idempotent).                                          ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create extension if not exists pgcrypto;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═════════════════════════════════════════════════════════════════════════

-- 1.1 Settings (single row, id = 1) ─────────────────────────────────────────
create table if not exists public.app_settings (
  id                     int primary key default 1 check (id = 1),
  event_title_en         text    not null default 'PAM Word Challenge',
  event_title_ar         text    not null default 'تحدي الكلمات',
  max_attempts           int     not null default 6    check (max_attempts between 3 and 10),
  time_limit_seconds     int     not null default 0    check (time_limit_seconds between 0 and 3600),  -- timer disabled
  plays_per_day          int     not null default 3    check (plays_per_day between 0 and 100),
  word_lang_mode         text    not null default 'ar' check (word_lang_mode in ('ui','en','ar')),
  hints_enabled          boolean not null default true,
  hint_penalty           int     not null default 150  check (hint_penalty between 0 and 1000),
  require_known_words    boolean not null default true,   -- only real words (dictionary) are accepted
  idle_timeout_seconds   int     not null default 90   check (idle_timeout_seconds between 15 and 3600),
  result_screen_seconds  int     not null default 25   check (result_screen_seconds between 5 and 300),
  leaderboard_size       int     not null default 10   check (leaderboard_size between 3 and 50),
  show_leaderboard       boolean not null default true,
  sound_enabled          boolean not null default true,
  id_min_length          int     not null default 4    check (id_min_length between 1 and 20),
  id_max_length          int     not null default 12   check (id_max_length between 1 and 20),
  timezone               text    not null default 'Asia/Kuwait',
  season_name            text    not null default 'Season 1',
  season_start           timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- v2 upgrade (safe if you already ran an older version of this file):
-- no timer, and guesses must be real words
alter table public.app_settings alter column time_limit_seconds  set default 0;
alter table public.app_settings alter column require_known_words set default true;
update public.app_settings set time_limit_seconds = 0, require_known_words = true where id = 1;

-- 1.2 Admins (links to Supabase Auth users) ─────────────────────────────────
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 1.3 Players ───────────────────────────────────────────────────────────────
create table if not exists public.players (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null check (char_length(full_name) between 2 and 80),
  id_number     text not null unique check (id_number ~ '^[0-9]{1,20}$'),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- 1.4 Categories (shown above the letter boxes) ─────────────────────────────
create table if not exists public.categories (
  id          bigint generated always as identity primary key,
  name_en     text not null check (char_length(btrim(name_en)) between 1 and 40),
  name_ar     text not null check (char_length(btrim(name_ar)) between 1 and 40),
  created_at  timestamptz not null default now(),
  unique (name_en)
);

-- 1.5 Words ─────────────────────────────────────────────────────────────────
create table if not exists public.words (
  id          bigint generated always as identity primary key,
  word        text    not null check (char_length(word) between 3 and 8),
  lang        text    not null check (lang in ('en','ar')),
  hint_en     text,
  hint_ar     text,
  active      boolean not null default false,   -- new words start OFF until an admin activates them
  created_at  timestamptz not null default now(),
  unique (word, lang)
);
create index if not exists words_lang_active_idx on public.words (lang, active);
alter table public.words
  add column if not exists category_id bigint references public.categories(id) on delete set null;
create index if not exists words_category_idx on public.words (category_id);
-- optional helper picture shown above the letter boxes (public URL in Supabase Storage)
alter table public.words add column if not exists image_url text;
alter table public.words alter column active set default false;   -- new words start OFF

-- 1.6 Dictionary — every real word players are allowed to GUESS ────────────
--     (answers come from public.words; those are always accepted as guesses)
--     Fill it from Admin → Dictionary (one-click English import or upload a .txt)
create table if not exists public.dictionary (
  lang  text not null check (lang in ('en','ar')),
  word  text not null check (char_length(word) between 3 and 8),
  primary key (lang, word)
);

-- 1.7 Games ─────────────────────────────────────────────────────────────────
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players(id) on delete cascade,
  word_id       bigint references public.words(id) on delete set null,
  answer        text not null,                 -- snapshot (survives word deletion)
  lang          text not null check (lang in ('en','ar')),
  status        text not null default 'playing'
                check (status in ('playing','won','lost','abandoned')),
  end_reason    text,                          -- solved | attempts | timeout | quit | idle | replaced
  guesses       text[] not null default '{}',
  max_attempts  int  not null,
  time_limit    int  not null default 0,
  hint_used     boolean not null default false,
  score         int  not null default 0,
  score_detail  jsonb,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   int
);
create index if not exists games_player_idx  on public.games (player_id, started_at desc);
create index if not exists games_started_idx on public.games (started_at desc);
create index if not exists games_status_idx  on public.games (status);

-- ═════════════════════════════════════════════════════════════════════════
-- 2. HELPERS
-- ═════════════════════════════════════════════════════════════════════════

-- Normalise a word: lower-case, strip spaces / Arabic diacritics / tatweel,
-- unify Alef forms (أ إ آ ٱ → ا). Must match API.util.normalize() in js/api.js
create or replace function public.normalize_word(p text)
returns text language sql immutable as $$
  select translate(
           regexp_replace(lower(coalesce(p, '')), '[\sً-ٰٟـ]', '', 'g'),
           'أإآٱ', 'اااا');
$$;

-- Validate + normalise words on every insert/update
create or replace function public.words_before_write()
returns trigger language plpgsql as $$
begin
  new.word    := public.normalize_word(new.word);
  new.lang    := lower(new.lang);
  new.hint_en := nullif(btrim(new.hint_en), '');
  new.hint_ar := nullif(btrim(new.hint_ar), '');
  if new.lang = 'en' and new.word !~ '^[a-z]+$' then
    raise exception 'INVALID_WORD_EN';
  end if;
  if new.lang = 'ar' and new.word !~ '^[ء-ي]+$' then
    raise exception 'INVALID_WORD_AR';
  end if;
  return new;
end $$;

drop trigger if exists trg_words_before_write on public.words;
create trigger trg_words_before_write
  before insert or update on public.words
  for each row execute function public.words_before_write();

-- Normalise dictionary entries; silently drop invalid ones (keeps bulk imports robust)
create or replace function public.dictionary_before_write()
returns trigger language plpgsql as $$
begin
  new.word := public.normalize_word(new.word);
  new.lang := lower(new.lang);
  if (new.lang = 'en' and new.word !~ '^[a-z]{3,8}$')
     or (new.lang = 'ar' and new.word !~ '^[ء-ي]{3,8}$') then
    return null;   -- skip row
  end if;
  return new;
end $$;

drop trigger if exists trg_dictionary_before_write on public.dictionary;
create trigger trg_dictionary_before_write
  before insert or update on public.dictionary
  for each row execute function public.dictionary_before_write();

-- Is the current authenticated user an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Wordle-style evaluation with correct duplicate-letter handling
create or replace function public.evaluate_guess(p_guess text, p_answer text)
returns text[] language plpgsql immutable as $$
declare
  v_g    text[];
  v_ans  text[];
  v_n    int;
  v_res  text[];
  v_used boolean[];
  i int;
  j int;
begin
  v_g    := regexp_split_to_array(p_guess, '');
  v_ans  := regexp_split_to_array(p_answer, '');
  v_n    := array_length(v_ans, 1);
  v_res  := array_fill('absent'::text, array[v_n]);
  v_used := array_fill(false, array[v_n]);

  for i in 1..v_n loop
    if v_g[i] = v_ans[i] then
      v_res[i]  := 'correct';
      v_used[i] := true;
    end if;
  end loop;

  for i in 1..v_n loop
    if v_res[i] <> 'correct' then
      for j in 1..v_n loop
        if not v_used[j] and v_g[i] = v_ans[j] then
          v_res[i]  := 'present';
          v_used[j] := true;
          exit;
        end if;
      end loop;
    end if;
  end loop;

  return v_res;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. ROW LEVEL SECURITY  (anon = nothing; admins = everything)
-- ═════════════════════════════════════════════════════════════════════════
alter table public.app_settings enable row level security;
alter table public.admins       enable row level security;
alter table public.players      enable row level security;
alter table public.words        enable row level security;
alter table public.games        enable row level security;
alter table public.categories   enable row level security;
alter table public.dictionary   enable row level security;

drop policy if exists "admin_all_categories" on public.categories;
create policy "admin_all_categories" on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_dictionary" on public.dictionary;
create policy "admin_all_dictionary" on public.dictionary
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_settings" on public.app_settings;
create policy "admin_all_settings" on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_read_admins" on public.admins;
create policy "admin_read_admins" on public.admins
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admin_all_players" on public.players;
create policy "admin_all_players" on public.players
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_words" on public.words;
create policy "admin_all_words" on public.words
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_games" on public.games;
create policy "admin_all_games" on public.games
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════
-- 4. PUBLIC GAME API  (called by the kiosk with the anon key)
-- ═════════════════════════════════════════════════════════════════════════

-- 4.1 Public settings ───────────────────────────────────────────────────────
create or replace function public.get_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select (to_jsonb(s) - 'id' - 'updated_at')
         || jsonb_build_object(
              'words_en', (select count(*) from public.words where active and lang = 'en'),
              'words_ar', (select count(*) from public.words where active and lang = 'ar'))
  from public.app_settings s where s.id = 1;
$$;

-- 4.2 Register / sign-in a player by ID number ──────────────────────────────
create or replace function public.register_player(p_full_name text, p_id_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s       public.app_settings;
  p       public.players;
  v_name  text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_id    text := regexp_replace(coalesce(p_id_number, ''), '\D', '', 'g');
  v_today int;
begin
  select * into s from public.app_settings where id = 1;
  if char_length(v_name) < 3 or char_length(v_name) > 80 then raise exception 'INVALID_NAME'; end if;
  if char_length(v_id) < s.id_min_length or char_length(v_id) > s.id_max_length then
    raise exception 'INVALID_ID';
  end if;

  insert into public.players (full_name, id_number) values (v_name, v_id)
  on conflict (id_number) do update
     set full_name = excluded.full_name, last_seen_at = now()
  returning * into p;

  select count(*) into v_today from public.games
   where player_id = p.id
     and (started_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date;

  return jsonb_build_object(
    'player_id',   p.id,
    'full_name',   p.full_name,
    'plays_today', v_today,
    'plays_left',  case when s.plays_per_day > 0 then greatest(0, s.plays_per_day - v_today) end);
end $$;

-- 4.3 Start a game: picks a random word the player has not seen yet ─────────
create or replace function public.start_game(p_player_id uuid, p_lang text default 'ar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s       public.app_settings;
  w       public.words;
  g       public.games;
  c       public.categories;
  v_lang  text;
  v_today int;
begin
  select * into s from public.app_settings where id = 1;
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  v_lang := case
              when s.word_lang_mode in ('en','ar') then s.word_lang_mode
              when p_lang in ('en','ar')           then p_lang
              else 'ar' end;

  -- close any unfinished game of this player
  update public.games
     set status = 'abandoned', end_reason = 'replaced', finished_at = now(),
         duration_ms = (extract(epoch from now() - started_at) * 1000)::int
   where player_id = p_player_id and status = 'playing';

  select count(*) into v_today from public.games
   where player_id = p_player_id
     and (started_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date;

  if s.plays_per_day > 0 and v_today >= s.plays_per_day then
    raise exception 'DAILY_LIMIT';
  end if;

  select * into w from public.words
   where active and lang = v_lang
     and id not in (select word_id from public.games
                     where player_id = p_player_id and word_id is not null)
   order by random() limit 1;

  if not found then
    select * into w from public.words where active and lang = v_lang order by random() limit 1;
  end if;
  if not found then raise exception 'NO_WORDS'; end if;

  insert into public.games (player_id, word_id, answer, lang, max_attempts, time_limit)
  values (p_player_id, w.id, w.word, v_lang, s.max_attempts, s.time_limit_seconds)
  returning * into g;

  update public.players set last_seen_at = now() where id = p_player_id;
  select * into c from public.categories where id = w.category_id;

  return jsonb_build_object(
    'game_id',      g.id,
    'length',       char_length(w.word),
    'lang',         v_lang,
    'category_en',  c.name_en,
    'category_ar',  c.name_ar,
    'image_url',    w.image_url,
    'max_attempts', g.max_attempts,
    'time_limit',   g.time_limit,
    'has_hint',     s.hints_enabled and coalesce(w.hint_en, w.hint_ar) is not null,
    'plays_left',   case when s.plays_per_day > 0 then greatest(0, s.plays_per_day - v_today - 1) end);
end $$;

-- 4.4 Leaderboard (champions) ───────────────────────────────────────────────
--   p_period: 'today' | 'week' | 'season' | 'all'
--   ID numbers are returned to admins only — players never receive them.
create or replace function public.get_leaderboard(
  p_period text default 'season', p_limit int default 10, p_player_id uuid default null)
returns table (rank bigint, full_name text, id_display text, total_score bigint,
               wins bigint, games bigint, best_time_ms int, is_me boolean)
language sql stable security definer set search_path = public as $$
  with s as (select * from public.app_settings where id = 1),
  agg as (
    select p.id, p.full_name, p.id_number,
           sum(g.score)::bigint                                   as total_score,
           count(*) filter (where g.status = 'won')               as wins,
           count(*)                                               as games,
           min(g.duration_ms) filter (where g.status = 'won')     as best_time_ms
      from public.games g
      join public.players p on p.id = g.player_id
      cross join s
     where g.status in ('won','lost')
       and (p_period = 'all'    or g.started_at >= s.season_start)
       and (p_period <> 'today' or (g.started_at at time zone s.timezone)::date
                                   = (now() at time zone s.timezone)::date)
       and (p_period <> 'week'  or g.started_at >= now() - interval '7 days')
     group by p.id, p.full_name, p.id_number
    having sum(g.score) > 0
  ),
  ranked as (
    select agg.id, agg.full_name, agg.id_number, agg.total_score, agg.wins, agg.games, agg.best_time_ms,
           row_number() over (
             order by agg.total_score desc, agg.wins desc, agg.best_time_ms asc nulls last,
                      agg.games asc, agg.full_name) as rnk
      from agg
  )
  select r.rnk,
         r.full_name,
         case when public.is_admin() then r.id_number end,
         r.total_score, r.wins, r.games, r.best_time_ms,
         (p_player_id is not null and r.id = p_player_id)
    from ranked r
   where r.rnk <= least(greatest(coalesce(p_limit, 10), 1), 500)
      or r.id = p_player_id
   order by r.rnk;
$$;

create or replace function public.player_rank(p_player_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select l.rank::int from public.get_leaderboard('season', 1, p_player_id) l where l.is_me;
$$;

-- 4.5 Submit a guess: evaluated + scored on the server ──────────────────────
create or replace function public.submit_guess(p_game_id uuid, p_guess text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s         public.app_settings;
  g         public.games;
  v_guess   text := public.normalize_word(p_guess);
  v_len     int;
  v_res     text[];
  v_attempt int;
  v_elapsed numeric;
  v_status  text;
  v_score   int := 0;
  v_detail  jsonb;
  v_base int; v_speed int; v_lenb int; v_hint int;
  v_rank    int;
  v_dur     int;
begin
  select * into s from public.app_settings where id = 1;
  select * into g from public.games where id = p_game_id for update;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if g.status <> 'playing' then raise exception 'GAME_OVER'; end if;

  v_len     := char_length(g.answer);
  v_elapsed := extract(epoch from now() - g.started_at);
  v_dur     := (v_elapsed * 1000)::int;

  -- server-side time limit (+5 s network grace)
  if g.time_limit > 0 and v_elapsed > g.time_limit + 5 then
    update public.games
       set status = 'lost', end_reason = 'timeout', finished_at = now(), duration_ms = v_dur
     where id = g.id;
    return jsonb_build_object('status', 'lost', 'reason', 'timeout', 'word', g.answer,
                              'attempt', coalesce(array_length(g.guesses, 1), 0),
                              'score', 0, 'duration_ms', v_dur);
  end if;

  if char_length(v_guess) <> v_len then raise exception 'INVALID_LENGTH'; end if;
  if (g.lang = 'en' and v_guess !~ '^[a-z]+$')
     or (g.lang = 'ar' and v_guess !~ '^[ء-ي]+$') then
    raise exception 'INVALID_CHARS';
  end if;
  -- reject words that do not exist (does NOT cost an attempt)
  if s.require_known_words
     and v_guess <> g.answer
     and not exists (select 1 from public.words      where word = v_guess and lang = g.lang)
     and not exists (select 1 from public.dictionary where word = v_guess and lang = g.lang) then
    raise exception 'NOT_IN_LIST';
  end if;

  v_res     := public.evaluate_guess(v_guess, g.answer);
  v_attempt := coalesce(array_length(g.guesses, 1), 0) + 1;

  v_status := case when v_guess = g.answer           then 'won'
                   when v_attempt >= g.max_attempts then 'lost'
                   else 'playing' end;

  if v_status = 'won' then
    v_base  := greatest(200, 1000 - (v_attempt - 1) * 150);
    v_speed := case when g.time_limit > 0
                    then round(300 * greatest(0, g.time_limit - v_elapsed) / g.time_limit)
                    else greatest(0, 300 - floor(v_elapsed)) end;
    v_lenb  := greatest(0, (v_len - 5) * 100);
    v_hint  := case when g.hint_used then -s.hint_penalty else 0 end;
    v_score := greatest(50, v_base + v_speed + v_lenb + v_hint);
    v_detail := jsonb_build_object('base', v_base, 'speed', v_speed, 'length', v_lenb,
                                   'hint', v_hint, 'total', v_score);
  end if;

  update public.games
     set guesses      = array_append(guesses, v_guess),
         status       = v_status,
         end_reason   = case v_status when 'won' then 'solved' when 'lost' then 'attempts' end,
         score        = v_score,
         score_detail = v_detail,
         finished_at  = case when v_status <> 'playing' then now() end,
         duration_ms  = case when v_status <> 'playing' then v_dur end
   where id = g.id;

  if v_status = 'won' then v_rank := public.player_rank(g.player_id); end if;

  return jsonb_build_object(
    'result',       to_jsonb(v_res),
    'status',       v_status,
    'attempt',      v_attempt,
    'max_attempts', g.max_attempts,
    'score',        v_score,
    'detail',       v_detail,
    'word',         case when v_status <> 'playing' then g.answer end,
    'rank',         v_rank,
    'duration_ms',  case when v_status <> 'playing' then v_dur end);
end $$;

-- 4.6 Hint (costs points) ───────────────────────────────────────────────────
create or replace function public.use_hint(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.app_settings;
  g public.games;
  w public.words;
begin
  select * into s from public.app_settings where id = 1;
  select * into g from public.games where id = p_game_id for update;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if g.status <> 'playing' then raise exception 'GAME_OVER'; end if;
  if not s.hints_enabled then raise exception 'HINTS_DISABLED'; end if;

  select * into w from public.words where id = g.word_id;
  update public.games set hint_used = true where id = g.id;

  return jsonb_build_object(
    'hint_en', coalesce(w.hint_en, w.hint_ar, ''),
    'hint_ar', coalesce(w.hint_ar, w.hint_en, ''),
    'penalty', s.hint_penalty);
end $$;

-- 4.7 End a game early (timeout / quit / idle) ──────────────────────────────
create or replace function public.end_game(p_game_id uuid, p_reason text default 'quit')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g        public.games;
  v_reason text := case when p_reason in ('timeout','quit','idle') then p_reason else 'quit' end;
begin
  update public.games
     set status      = case when v_reason = 'idle' then 'abandoned' else 'lost' end,
         end_reason  = v_reason,
         finished_at = now(),
         duration_ms = (extract(epoch from now() - started_at) * 1000)::int
   where id = p_game_id and status = 'playing'
  returning * into g;

  if not found then
    select * into g from public.games where id = p_game_id;
    if not found then raise exception 'GAME_NOT_FOUND'; end if;
  end if;

  return jsonb_build_object(
    'status', g.status, 'reason', g.end_reason, 'word', g.answer,
    'attempt', coalesce(array_length(g.guesses, 1), 0),
    'duration_ms', g.duration_ms, 'score', g.score);
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. ADMIN API
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.app_settings;
  r jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into s from public.app_settings where id = 1;

  select jsonb_build_object(
    'players',        (select count(*) from public.players),
    'players_season', (select count(distinct player_id) from public.games where started_at >= s.season_start),
    'games_today',    (select count(*) from public.games
                        where (started_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date),
    'games_season',   (select count(*) from public.games where started_at >= s.season_start and status in ('won','lost')),
    'wins_season',    (select count(*) from public.games where started_at >= s.season_start and status = 'won'),
    'avg_score',      (select coalesce(round(avg(score)), 0) from public.games
                        where started_at >= s.season_start and status = 'won'),
    'avg_attempts',   (select coalesce(round(avg(array_length(guesses, 1))::numeric, 2), 0) from public.games
                        where started_at >= s.season_start and status = 'won'),
    'words_en',       (select count(*) from public.words where lang = 'en' and active),
    'words_ar',       (select count(*) from public.words where lang = 'ar' and active),
    'words_total',    (select count(*) from public.words),
    'dict_en',        (select count(*) from public.dictionary where lang = 'en'),
    'dict_ar',        (select count(*) from public.dictionary where lang = 'ar'),
    'categories',     (select count(*) from public.categories),
    'season_name',    s.season_name,
    'season_start',   s.season_start,
    'daily', (select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb) from (
                select (started_at at time zone s.timezone)::date as day,
                       count(*) as games,
                       count(*) filter (where status = 'won') as wins
                  from public.games
                 where started_at >= now() - interval '14 days'
                 group by 1) d)
  ) into r;
  return r;
end $$;

-- Delete every game (and its score) played on one calendar day, in the app's time zone.
-- p_dry_run = true only counts, so the admin page can show a preview first.
create or replace function public.admin_delete_day(p_day date, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s         public.app_settings;
  v_games   int;
  v_players int;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_day is null then raise exception 'INVALID_DAY'; end if;
  select * into s from public.app_settings where id = 1;

  select count(*), count(distinct player_id) into v_games, v_players
    from public.games
   where (started_at at time zone s.timezone)::date = p_day;

  if not p_dry_run and v_games > 0 then
    delete from public.games
     where (started_at at time zone s.timezone)::date = p_day;
  end if;

  return jsonb_build_object('day', p_day, 'games', v_games, 'players', v_players, 'deleted', not p_dry_run);
end $$;

create or replace function public.admin_new_season(p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.app_settings
     set season_start = now(),
         season_name  = coalesce(nullif(btrim(p_name), ''), season_name),
         updated_at   = now()
   where id = 1;
  return public.get_public_settings();
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5b. WORD IMAGES (Supabase Storage)
--     Public bucket so the game can display images by URL.
--     File names are random, so a URL never reveals the word.
--     Only admins can upload / replace / delete; nobody can list the bucket.
-- ═════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('word-images', 'word-images', true, 3145728, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "word_images_admin_select" on storage.objects;
create policy "word_images_admin_select" on storage.objects
  for select to authenticated using (bucket_id = 'word-images' and public.is_admin());

drop policy if exists "word_images_admin_insert" on storage.objects;
create policy "word_images_admin_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'word-images' and public.is_admin());

drop policy if exists "word_images_admin_update" on storage.objects;
create policy "word_images_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'word-images' and public.is_admin())
  with check (bucket_id = 'word-images' and public.is_admin());

drop policy if exists "word_images_admin_delete" on storage.objects;
create policy "word_images_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'word-images' and public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════
-- 6. PRIVILEGES
-- ═════════════════════════════════════════════════════════════════════════
revoke all on public.app_settings, public.admins, public.players, public.words, public.games from anon;
grant select, insert, update, delete on public.players, public.words, public.games to authenticated;
grant select, update on public.app_settings to authenticated;
revoke all on public.categories, public.dictionary from anon;
grant select, insert, update, delete on public.categories, public.dictionary to authenticated;
grant select on public.admins to authenticated;

revoke execute on function public.evaluate_guess(text, text)   from public, anon, authenticated;
revoke execute on function public.player_rank(uuid)            from public, anon, authenticated;

grant execute on function public.get_public_settings()                  to anon, authenticated;
grant execute on function public.register_player(text, text)            to anon, authenticated;
grant execute on function public.start_game(uuid, text)                 to anon, authenticated;
grant execute on function public.submit_guess(uuid, text)               to anon, authenticated;
grant execute on function public.use_hint(uuid)                         to anon, authenticated;
grant execute on function public.end_game(uuid, text)                   to anon, authenticated;
grant execute on function public.get_leaderboard(text, int, uuid)       to anon, authenticated;
grant execute on function public.is_admin()                             to anon, authenticated;
grant execute on function public.admin_stats()                          to authenticated;
grant execute on function public.admin_new_season(text)                 to authenticated;
revoke execute on function public.admin_delete_day(date, boolean) from public, anon;
grant execute on function public.admin_delete_day(date, boolean) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 7. STARTER DATA
-- ═════════════════════════════════════════════════════════════════════════
-- (none) The game starts empty: add your categories and words from the admin page.
-- The game is Arabic-only:
alter table public.app_settings alter column word_lang_mode set default 'ar';
alter table public.app_settings alter column season_name    set default 'الموسم الأول';
update public.app_settings set word_lang_mode = 'ar' where id = 1;

-- ═════════════════════════════════════════════════════════════════════════
-- 8. MAKE ME ADMIN
--    First create the user in: Authentication → Users → Add user
--    Then replace the email below and run ONLY this statement.
-- ═════════════════════════════════════════════════════════════════════════
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'admin@example.com'
-- on conflict do nothing;

-- ═════════════════════════════════════════════════════════════════════════
-- USEFUL MAINTENANCE (run manually when needed)
-- ═════════════════════════════════════════════════════════════════════════
-- Empty the dictionary for one language:
--   delete from public.dictionary where lang = 'ar';
-- Clear all test plays before the event:
--   delete from public.games;  delete from public.players;
-- Start a fresh champions board without deleting history:
--   update public.app_settings set season_start = now(), season_name = 'Season 2' where id = 1;
