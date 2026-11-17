-- Temps d'Abondance : journal d'activité des clients + accès admin.
-- À coller UNE fois dans Supabase → SQL Editor → Run. On peut le relancer sans risque.

-- 1) Table des événements (une ligne par action d'un client)
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),             -- heure du serveur (fiable, ne dépend pas du téléphone)
  client_ts  timestamptz,                                     -- heure du téléphone du client
  email      text,
  name       text,
  device     text,                                            -- identifiant de l'appareil (navigateur)
  session    text,                                            -- identifiant de la visite
  type       text not null,                                   -- open, login, view, act, video, priere, lecon, cadeau, chat, refund, away, back, error
  detail     jsonb not null default '{}'::jsonb,
  page       text,
  ua         text,                                            -- navigateur / système
  lang       text,
  tz         text,
  screen     text,
  -- adresse IP et pays, lus par le serveur (le client ne peut pas les falsifier)
  ip         text default nullif(split_part(coalesce(
                current_setting('request.headers', true)::json->>'cf-connecting-ip',
                current_setting('request.headers', true)::json->>'x-real-ip',
                current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1), ''),
  country    text default current_setting('request.headers', true)::json->>'cf-ipcountry',
  constraint events_sizes check (
    char_length(type) <= 40 and coalesce(char_length(email), 0) <= 200 and coalesce(char_length(name), 0) <= 200
    and coalesce(char_length(ua), 0) <= 400 and pg_column_size(detail) <= 4000)
);
create index if not exists events_email_idx   on public.events (lower(email));
create index if not exists events_device_idx  on public.events (device);
create index if not exists events_created_idx on public.events (created_at desc);

-- 2) Sécurité : les clients peuvent seulement AJOUTER. Personne ne peut modifier ni effacer (preuve).
alter table public.events enable row level security;
drop policy if exists "clients ajoutent" on public.events;
create policy "clients ajoutent" on public.events for insert to anon, authenticated with check (true);
drop policy if exists "admin lit" on public.events;
create policy "admin lit" on public.events for select to authenticated
  using ((auth.jwt() ->> 'email') = 'lr.bussine@gmail.com');
revoke update, delete, truncate on public.events from anon, authenticated;
-- l'heure et l'IP viennent toujours du serveur
revoke insert on public.events from anon, authenticated;
grant insert (client_ts, email, name, device, session, type, detail, page, ua, lang, tz, screen)
  on public.events to anon, authenticated;
grant select on public.events to authenticated;

-- 3) Vue « clients » : un résumé par e-mail (lue seulement par l'admin, grâce à security_invoker)
create or replace view public.clients with (security_invoker = true) as
select lower(email)                                   as email,
       (array_agg(name order by created_at desc))[1]  as name,
       min(created_at)                                as first_seen,
       max(created_at)                                as last_seen,
       count(*)                                       as events,
       count(distinct session)                        as sessions,
       count(distinct device)                         as devices,
       count(distinct ip)                             as ips,
       count(*) filter (where type = 'login')         as logins,
       coalesce(sum((detail->>'secs')::int) filter (where type = 'away' and (detail->>'secs') ~ '^\d+$'
                and (detail->>'secs')::int < 21600), 0) as secs,
       bool_or(type = 'refund')                       as refund,
       (array_agg(country order by created_at desc) filter (where country is not null))[1] as country
from public.events
where email is not null and email <> ''
group by lower(email);
grant select on public.clients to authenticated;
