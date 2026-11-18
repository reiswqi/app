-- Temps d'Abondance : journal d'activité des clients. Exécuté automatiquement au démarrage du serveur (sans risque si déjà fait).
create table if not exists events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),   -- heure du serveur (fiable)
  client_ts  timestamptz,                           -- heure du téléphone du client
  email      text,
  name       text,
  device     text,                                  -- identifiant de l'appareil (navigateur)
  session    text,                                  -- identifiant de la visite
  type       text not null,                         -- open, login, view, act, video, priere, lecon, cadeau, chat, refund, away, back, error
  detail     jsonb not null default '{}'::jsonb,
  page       text,
  ua         text,
  lang       text,
  tz         text,
  screen     text,
  ip         text,                                  -- IP vue par le serveur (le client ne peut pas la choisir)
  ip_chain   text,                                  -- en-tête X-Forwarded-For complet, pour le dossier
  country    text
);
create index if not exists events_email_idx   on events (email);
create index if not exists events_device_idx  on events (device);
create index if not exists events_created_idx on events (created_at desc);
create index if not exists events_type_idx    on events (type);

-- Preuve : aucune ligne ne peut être modifiée ni effacée.
create or replace function events_lock() returns trigger language plpgsql as $$
begin raise exception 'Le journal est en lecture seule : aucune modification ni suppression.'; end $$;
drop trigger if exists events_no_change on events;
create trigger events_no_change before update or delete on events for each row execute function events_lock();
drop trigger if exists events_no_truncate on events;
create trigger events_no_truncate before truncate on events for each statement execute function events_lock();

-- Résumé par client (un e-mail = un client)
create or replace view clients as
select email,
       (array_agg(name order by created_at desc) filter (where name is not null))[1] as name,
       min(created_at)                                     as first_seen,
       max(created_at)                                     as last_seen,
       count(*)::int                                       as events,
       count(distinct session)::int                        as sessions,
       count(distinct device)::int                         as devices,
       count(distinct ip)::int                             as ips,
       (count(*) filter (where type = 'login'))::int       as logins,
       coalesce(sum(least((detail->>'secs')::int, 21600)) filter (where type = 'away' and (detail->>'secs') ~ '^\d{1,6}$'), 0)::int as secs,
       bool_or(type = 'refund')                            as refund,
       (array_agg(country order by created_at desc) filter (where country is not null))[1] as country
from events
where email is not null and email <> ''
group by email;

-- Comptes des clients (mot de passe). Le mot de passe n'est jamais stocké : seulement une empreinte scrypt salée.
create table if not exists users (
  id              bigint generated always as identity primary key,
  email           text unique not null,
  name            text,
  pass_hash       text not null,
  pass_by         text not null default 'client',   -- client = choisi par le client ; admin = temporaire donné par Lucas
  pass_changed_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  created_ip      text,
  created_country text,
  created_ua      text,
  created_device  text,
  last_login_at   timestamptz
);
-- chaque action peut être rattachée au compte connecté (preuve : action faite avec le mot de passe du client)
alter table events add column if not exists uid bigint;
alter table events add column if not exists verified boolean not null default false;
create index if not exists events_uid_idx on events (uid);

-- Ventes KashPay (webhooks signés). Une ligne par événement reçu ; les renvois du même événement sont ignorés.
create table if not exists purchases (
  id            bigint generated always as identity primary key,
  received_at   timestamptz not null default now(),
  event         text not null,              -- order.paid, order.refunded, order.chargeback, subscription.*, manual.grant…
  kp_id         text,                       -- data.id (transaction KashPay)
  status        text,
  email         text,
  name          text,
  phone         text,
  amount        integer,                    -- en centimes
  net_amount    integer,
  currency      text,
  offers        jsonb,
  payment_id    text,                       -- id Stripe (pi_…)
  card_holder   text,
  paid_at       timestamptz,
  refunded_at   timestamptz,
  chargeback_at timestamptz,
  event_at      timestamptz,
  tracking      jsonb,
  raw           jsonb not null,
  ip            text,
  unique (event, kp_id)
);
create index if not exists purchases_email_idx on purchases (email);
create index if not exists purchases_received_idx on purchases (received_at desc);
