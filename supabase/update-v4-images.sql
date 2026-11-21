-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PAM Word Challenge — update v4                                    ║
-- ║  • helper images for words   • ID numbers hidden from players      ║
-- ║  Run once in Supabase → SQL Editor. Safe to run again.             ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.words add column if not exists image_url text;

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

-- game start now also returns the word's image
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

-- champions board: ID numbers only for admins
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
