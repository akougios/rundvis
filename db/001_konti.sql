-- Rundvis — konti, abonnement og forbrug.
--
-- Køres én gang i Supabase under SQL Editor. Supabase ejer selv auth.users; alt herunder
-- hænger på den.
--
-- Vigtigt om sikkerhed: browseren taler direkte med databasen med den offentlige anon-nøgle,
-- så det er row level security der afgør hvad en bruger kan se — ikke frontenden. Serveren
-- bruger service-nøglen og går uden om RLS; det er med vilje, og derfor må service-nøglen
-- aldrig sendes til browseren.

-- ─────────────────────────────────────────────────────────────────────────────
-- Kontoen: ét mæglerkontor eller én kæde. Det er den der betaler.
create table if not exists konto (
  id                   uuid primary key default gen_random_uuid(),
  navn                 text not null,
  oprettet             timestamptz not null default now(),

  -- Stripe. Sættes af webhooken, aldrig af browseren.
  stripe_kunde_id      text unique,
  stripe_abonnement_id text unique,
  -- ingen | aktiv | forfalden | opsagt
  abonnement_status    text not null default 'ingen',
  -- Hvornår den nuværende betalte periode løber ud. Bruges til at tælle boliger per periode.
  periode_slut         timestamptz,
  inkluderede_boliger  int not null default 10
);

-- Hvem hører til hvilken konto. Flere brugere per konto fra dag ét: et kontor med fire
-- mæglere deler ikke én adgangskode, og hvis de gør, kan vi ikke se hvem der bruger hvad.
create table if not exists medlemskab (
  bruger_id uuid not null references auth.users(id) on delete cascade,
  konto_id  uuid not null references konto(id) on delete cascade,
  rolle     text not null default 'medlem',   -- ejer | medlem
  primary key (bruger_id, konto_id)
);

-- Én sag. Boliger er enheden kunden betaler per, så de skal tælles, ikke gættes.
create table if not exists bolig (
  id       uuid primary key default gen_random_uuid(),
  konto_id uuid not null references konto(id) on delete cascade,
  adresse  text,
  oprettet timestamptz not null default now()
);

-- Én linje per genereret klip. Den vigtigste tabel i skemaet og den letteste at glemme:
-- uden den kan vi hverken fakturere for forbrug ud over det inkluderede, se hvilke kunder
-- der er tabsgivende, eller svare på hvad en video reelt koster.
--
-- Skrives OGSÅ når kaldet fejler. Et fejlet klip bliver ofte faktureret alligevel, og en
-- omkostning der ikke står nogen steder, findes stadig på regningen.
create table if not exists forbrug (
  id            bigserial primary key,
  konto_id      uuid not null references konto(id) on delete cascade,
  bolig_id      uuid references bolig(id) on delete set null,
  bruger_id     uuid references auth.users(id) on delete set null,
  model         text not null,
  kvalitet      text,
  resultat      text not null,            -- ok | fejl
  kostpris_usd  numeric(10,4),
  tidspunkt     timestamptz not null default now()
);

create index if not exists forbrug_konto_tid on forbrug (konto_id, tidspunkt desc);
create index if not exists bolig_konto_tid   on bolig   (konto_id, oprettet desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- En ny bruger får sin egen konto. Uden det her ville en tilmelding efterlade en bruger
-- uden noget at høre til, og hver eneste senere forespørgsel ville finde ingenting.
create or replace function haandter_ny_bruger()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare ny_konto uuid;
begin
  insert into konto (navn) values (coalesce(new.email, 'Nyt kontor')) returning id into ny_konto;
  insert into medlemskab (bruger_id, konto_id, rolle) values (new.id, ny_konto, 'ejer');
  return new;
end;
$$;

drop trigger if exists ved_ny_bruger on auth.users;
create trigger ved_ny_bruger after insert on auth.users
  for each row execute function haandter_ny_bruger();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security. Alt er lukket indtil en regel åbner det.
alter table konto      enable row level security;
alter table medlemskab enable row level security;
alter table bolig      enable row level security;
alter table forbrug    enable row level security;

-- Hjælper: de konti den aktuelle bruger hører til.
create or replace function mine_konti()
returns setof uuid
language sql stable security definer set search_path = public
as $$ select konto_id from medlemskab where bruger_id = auth.uid() $$;

drop policy if exists konto_laes on konto;
create policy konto_laes on konto for select using (id in (select mine_konti()));

drop policy if exists medlemskab_laes on medlemskab;
create policy medlemskab_laes on medlemskab for select using (bruger_id = auth.uid());

drop policy if exists bolig_laes on bolig;
create policy bolig_laes on bolig for select using (konto_id in (select mine_konti()));
drop policy if exists bolig_skriv on bolig;
create policy bolig_skriv on bolig for insert with check (konto_id in (select mine_konti()));

-- Forbrug kan læses, aldrig skrives fra browseren: det er grundlaget for en faktura.
drop policy if exists forbrug_laes on forbrug;
create policy forbrug_laes on forbrug for select using (konto_id in (select mine_konti()));

-- Ingen skrivepolitik på konto. Abonnementsstatus sættes udelukkende af Stripe-webhooken
-- med service-nøglen. En bruger der kan skrive til sin egen abonnement_status, har gratis
-- adgang for evigt.
