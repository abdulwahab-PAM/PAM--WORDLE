-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PAM Word Challenge — update v7: optional game timer               ║
-- ║  Adds the timer on/off switch used by Admin → Settings.            ║
-- ║  Run once in Supabase → SQL Editor. Safe to run again.             ║
-- ║  (run v4, v5 and v6 first if you have not yet)                     ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.app_settings add column if not exists timer_enabled boolean not null default false;
alter table public.app_settings alter column time_limit_seconds set default 120;
update public.app_settings set time_limit_seconds = 120 where id = 1 and time_limit_seconds = 0;

-- start_game: gives each game the time limit only when the timer is switched on
create or replace function public.start_game(p_player_id uuid, p_lang text default 'ar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s       public.app_settings;
  w       public.words;
  g       public.games;
  c       public.categories;
  v_lang  text;
  v_today int;
  v_active   int;
  v_recent_n int;
  v_recent   bigint[];
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

  -- ── Fair shuffle ─────────────────────────────────────────────────────
  --  1. words this player has never had come first (no repeats until they have seen them all)
  --  2. the last few words served to anyone are pushed back (no same word twice in a row)
  --  3. the least-served words come first, so every word is played about equally
  --  4. ties are broken at random
  select count(*) into v_active from public.words where active and lang = v_lang;
  if v_active = 0 then raise exception 'NO_WORDS'; end if;
  v_recent_n := least(3, v_active - 1);

  select coalesce(array_agg(r.word_id), '{}'::bigint[]) into v_recent
    from (select gm.word_id
            from public.games gm
           where gm.lang = v_lang and gm.word_id is not null
           order by gm.started_at desc
           limit v_recent_n) r;

  select wd.* into w
    from public.words wd
    left join (select gm.word_id,
                      count(*)                         as served,
                      bool_or(gm.player_id = p_player_id) as seen
                 from public.games gm
                where gm.word_id is not null
                group by gm.word_id) st
      on st.word_id = wd.id
   where wd.active and wd.lang = v_lang
   order by coalesce(st.seen, false),
            (wd.id = any(v_recent)),
            coalesce(st.served, 0),
            random()
   limit 1;
  if not found then raise exception 'NO_WORDS'; end if;

  insert into public.games (player_id, word_id, answer, lang, max_attempts, time_limit)
  values (p_player_id, w.id, w.word, v_lang, s.max_attempts,
          case when s.timer_enabled then greatest(s.time_limit_seconds, 10) else 0 end)
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
