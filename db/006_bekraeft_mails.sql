-- Rundvis — markér eksisterende brugere som bekræftede, så de kan logge ind.
--
-- Køres i Supabase SQL Editor. Kan køres igen uden skade.
--
-- HVORFOR DEN FINDES. At slå "Confirm email" fra i dashboardet gælder kun fremad. Brugere der
-- allerede findes med email_confirmed_at = null bliver IKKE bekræftet af at man slår flueben
-- fra — de bliver stadig afvist med email_not_confirmed når de forsøger at logge ind. Det
-- rammer bl.a. testeren der fik det første bekræftelseslink dengang Site URL pegede på
-- localhost: linket virkede aldrig, så kontoen står ubekræftet og kan ikke bruges.
--
-- Der er desuden rapporter om at helt nye tilmeldinger også kan blive afvist selv med
-- flueben fra (supabase/supabase#29632). Derfor er det her både en oprydning og et sikkerhedsnet:
-- virker tilmeldingen ikke efter du har slået fluebenet fra, så kør den her igen bagefter.
--
-- RØR IKKE confirmed_at. Den er en genereret kolonne i auth.users — udregnet ud fra
-- email_confirmed_at og phone_confirmed_at — så et forsøg på at skrive til den fejler.
-- Sæt kun email_confirmed_at; confirmed_at følger selv med.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SE HVEM DER ER RAMT, FØR DU RETTER
--
-- Kør den her først. Står der ingen rækker, er der ingenting at rette, og så ligger problemet
-- et andet sted end i bekræftelsen.

select id, email, created_at, last_sign_in_at
from auth.users
where email_confirmed_at is null
order by created_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BEKRÆFT DEM
--
-- email_verified i metadata sættes med, fordi nogle af Supabases egne tjek læser den i stedet
-- for kolonnen. coalesce holder den idempotent: en bruger der allerede er bekræftet beholder
-- sit oprindelige tidspunkt i stedet for at få nu.

update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                         || '{"email_verified": true}'::jsonb
where email_confirmed_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SE AT DET SIDDER
--
-- ubekraeftede SKAL være 0 bagefter.

select count(*) filter (where email_confirmed_at is null) as ubekraeftede,
       count(*)                                           as brugere_i_alt
from auth.users;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. HAR TESTEREN OGSÅ EN KONTO?
--
-- Bekræftelsen her giver adgang til at logge ind. Den giver ikke gratis boliger — det gør
-- 005_tester.sql. Og kontoen skal findes: den laves af triggeren ved_ny_bruger ved tilmelding,
-- men en bruger oprettet i dashboardet er værd at tjekke, for uden konto fejler /api/konto.
--
-- Står der en bruger uden konto_id her, er triggeren ikke løbet for ham.

select u.email,
       u.email_confirmed_at is not null as kan_logge_ind,
       m.konto_id,
       k.gratis_boliger,
       k.abonnement_status
from auth.users u
left join medlemskab m on m.bruger_id = u.id
left join konto k      on k.id = m.konto_id
order by u.created_at;
