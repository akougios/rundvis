-- Rundvis — gemte logoer og videoer.
--
-- Køres én gang i Supabase under SQL Editor, efter 001_konti.sql.
--
-- To ting gemmes, og de har modsatte livstider. Logoet hører til kontoret og bliver liggende
-- indtil nogen skifter det. Videoen hører til en bolig, og en bolig er solgt eller taget af
-- markedet inden for et par måneder — derfor slettes den af sig selv efter tredive dage.
--
-- Den frist er ikke sparsommelighed; lagring koster os cirka fire kroner om måneden ved
-- hundrede kunder. Den er fordi vi opbevarer kundernes boligbilleder, og der står mennesker
-- på nogle af dem. En fast frist er noget vi kan skrive i privatlivspolitikken og holde uden
-- at nogen skal rydde op manuelt.
--
-- Og den skal SIGES i brugerfladen. En mægler der tror hans videoer ligger hos os for evigt,
-- oplever sletningen som et løfte vi brød, frem for som den oprydning den er.

-- ─────────────────────────────────────────────────────────────────────────────
-- Logoet hænger på kontoret, ikke på brugeren: fire mæglere på samme kontor har samme logo,
-- og den femte der logger ind skal ikke skulle finde filen frem igen.
alter table konto add column if not exists logo_sti  text;
alter table konto add column if not exists logo_navn text;

-- ─────────────────────────────────────────────────────────────────────────────
-- Én gemt video. Samme bolig kan have flere: tre formater, og en ny kørsel efter at
-- mægleren har skiftet et billede ud.
create table if not exists gemt_video (
  id         uuid primary key default gen_random_uuid(),
  konto_id   uuid not null references konto(id) on delete cascade,
  bolig_id   uuid references bolig(id) on delete set null,
  bruger_id  uuid references auth.users(id) on delete set null,
  sti        text not null,              -- stien i storage-bucket'en
  navn       text,                       -- det mægleren ser, fx "Strandvejen 12 · 9:16"
  format     text,                       -- 16:9 | 9:16 | 1:1
  bytes      bigint,
  oprettet   timestamptz not null default now(),
  -- Sat ved oprettelsen frem for regnet ud ved læsning. Så kan fristen ændres for nye
  -- videoer uden at flytte dem der allerede ligger, og en video kan forlænges enkeltvis
  -- hvis vi en dag vil det.
  udloeber   timestamptz not null default now() + interval '30 days'
);

create index if not exists gemt_video_konto_tid on gemt_video (konto_id, oprettet desc);
create index if not exists gemt_video_udloeb    on gemt_video (udloeber);

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket'en. Privat: en boligvideo er mæglerens materiale før boligen er annonceret, og en
-- offentlig bucket med gættelige stier er ingen adgangskontrol.
insert into storage.buckets (id, name, public)
values ('rundvis', 'rundvis', false)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security.
alter table gemt_video enable row level security;

drop policy if exists gemt_video_laes on gemt_video;
create policy gemt_video_laes on gemt_video for select using (konto_id in (select mine_konti()));

-- Slet må man gerne selv: det er ens eget materiale, og en mægler der vil af med en video
-- fra en sag der faldt fra hinanden skal ikke skrive til os om det.
drop policy if exists gemt_video_slet on gemt_video;
create policy gemt_video_slet on gemt_video for delete using (konto_id in (select mine_konti()));

-- Men ikke skrive. Rækken oprettes af serveren med service-nøglen samtidig med at filen
-- lægges op, så en række aldrig kan pege på en fil der ikke findes — eller på en andens.

-- Filerne i bucket'en: læsning gennem signerede links fra serveren, så der er ingen
-- browser-politik at skrive. Skrivning sker udelukkende med service-nøglen.
drop policy if exists rundvis_ingen_browser on storage.objects;

-- ─────────────────────────────────────────────────────────────────────────────
-- Oprydningen. Kaldes af /api/filer/ryd én gang i døgnet.
--
-- Sletter rækkerne og returnerer stierne, så kaldestedet kan slette selve filerne bagefter.
-- Den rækkefølge er med vilje: en fil uden række er spildplads, en række uden fil er en
-- knap der fejler i hovedet på mægleren.
create or replace function ryd_udloebne_videoer()
returns table (sti text)
language sql security definer set search_path = public
as $$
  delete from gemt_video where udloeber < now() returning gemt_video.sti;
$$;
