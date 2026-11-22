-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  PAM Word Challenge — update v5: delete one day's games & scores   ║
-- ║  Run once in Supabase → SQL Editor. Safe to run again.             ║
-- ╚════════════════════════════════════════════════════════════════════╝

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

revoke execute on function public.admin_delete_day(date, boolean) from public, anon;
grant execute on function public.admin_delete_day(date, boolean) to authenticated;
