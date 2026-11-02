-- Rundvis — registrering af accepteret databehandleraftale.
--
-- Køres i Supabase SQL Editor efter 003.
--
-- GDPR artikel 28 kræver en skriftlig aftale mellem den dataansvarlige (mægleren) og
-- databehandleren (os). "Skriftlig, herunder i elektronisk form" — så et flueben ved oprettelsen
-- opfylder kravet. Det der gør den noget værd, er beviset: hvem accepterede hvilken version,
-- hvornår. Uden det er aftalen en påstand.
--
-- Versionen gemmes som tekst og ikke som et flueben. Ændrer vi aftalen, skal vi kunne se hvem
-- der har accepteret hvad — og hvem der mangler at acceptere den nye.

alter table konto add column if not exists aftale_version     text;
alter table konto add column if not exists aftale_accepteret  timestamptz;
alter table konto add column if not exists aftale_af          text;

comment on column konto.aftale_version is
  'Versionen af databehandleraftalen kontoen har accepteret, fx 2026-11-02. Null = ikke accepteret.';
comment on column konto.aftale_accepteret is
  'Tidspunktet for accepten.';
comment on column konto.aftale_af is
  'Mailadressen paa den bruger der satte fluebenet.';

-- Ingen ny tabel, altsaa ingen nye GRANTs noedvendige: kolonnerne arver konto's rettigheder.
-- (Se noten om Supabases aendring 30. oktober 2026 i 003_adgang.sql.)

-- ─────────────────────────────────────────────────────────────────────────────
-- Hvem mangler at acceptere:
--
--   select navn, aftale_version, aftale_accepteret
--   from konto
--   where aftale_version is distinct from '2026-11-02'
--   order by oprettet desc;
--
-- De to ejerkonti har aldrig set fluebenet, fordi de blev oprettet foer det fandtes. Det er
-- i orden - man indgaar ikke en databehandleraftale med sig selv. Men de vil staa paa listen,
-- saa her er de sat til at vaere accepteret, saa listen kun viser rigtige kunder:
update konto set aftale_version = '2026-11-02',
                 aftale_accepteret = now(),
                 aftale_af = 'ejer — ingen aftale noedvendig'
where fri_adgang and aftale_version is null;
