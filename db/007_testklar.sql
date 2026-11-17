-- Rundvis — gør en testrunde klar: bekræft mails, giv gratis boliger, og se hvem der er klar.
--
-- Køres i Supabase SQL Editor. Kan køres igen uden skade, og skal køres igen hver gang du
-- tilføjer en tester.
--
-- Den samler det 006 og 005 gør hver for sig, fordi det i praksis er én handling: en tester
-- er klar når han både kan logge ind OG har boliger at bruge. Mangler det ene, opdager man
-- det først når han sidder med telefonen i hånden.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SÆT TESTERNES MAILS IND HER. Med små bogstaver — der sammenlignes på lower(email).
-- Antallet af gratis boliger står i trin 2.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BEKRÆFT ALLE UBEKRÆFTEDE BRUGERE
--
-- At slå "Confirm email" fra i dashboardet gælder kun fremad: en bruger der allerede findes
-- med email_confirmed_at = null bliver stadig afvist med email_not_confirmed. Det rammer
-- bl.a. den tester hvis første bekræftelseslink pegede på localhost og aldrig virkede.
--
-- Der er desuden rapporter om at nye tilmeldinger kan blive afvist selv med fluebenet fra
-- (supabase/supabase#29632), så kør trin 1 igen hvis en tilmelding bliver nægtet.
--
-- RØR IKKE confirmed_at. Den er en genereret kolonne i auth.users, udregnet ud fra
-- email_confirmed_at og phone_confirmed_at, så et forsøg på at skrive til den fejler.
--
-- email_verified sættes med i metadata, fordi nogle af Supabases egne tjek læser den i
-- stedet for kolonnen. coalesce holder det idempotent: en der allerede er bekræftet beholder
-- sit oprindelige tidspunkt i stedet for at få nu.

update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                         || '{"email_verified": true}'::jsonb
where email_confirmed_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GIV TESTERNE GRATIS BOLIGER
--
-- EN BOLIG, IKKE EN VIDEO. Tælleren tæller distinkte bolig_id i forbrug, ikke klip og ikke
-- kørsler. Opgraderer testeren den samme bolig igen — fx fordi ét klip blev dårligt — tæller
-- den ikke en gang til. Det er med vilje: ellers blev han afbrudt midt i sin sidste bolig med
-- halvdelen af billederne opgraderet.
--
-- HVAD DET KOSTER DIG. Hver bolig er en rigtig regning hos Luma, ikke en kvote i vores egen
-- database. En bolig på 13 billeder koster omkring 58 kr. Tre boliger til tre testere er
-- altså cirka 520 kr af dine egne penge. Sæt tallet bevidst.
--
-- Vejen går auth.users -> medlemskab -> konto, fordi mailadressen kun står på brugeren.
-- Kontoen findes allerede: triggeren ved_ny_bruger laver den ved tilmelding.

update konto set gratis_boliger = 3
where id in (
  select m.konto_id
  from medlemskab m
  join auth.users u on u.id = m.bruger_id
  where lower(u.email) = any (array[
    'lars.engelbrecht@yahoo.dk'
    -- , 'navn@eksempel.dk'
    -- , 'navn2@eksempel.dk'
  ])
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ER DE KLAR?
--
-- Én række per bruger. porten-kolonnen siger hvad opgraderingsRet i api/_konto.js vil
-- svare næste gang han trykker Opgradér — i samme rækkefølge som koden tjekker:
-- fri adgang, så abonnement, så gratis boliger, ellers lukket.
--
-- Står der LUKKET ud for en tester, er han ikke klar, uanset at han kan logge ind.
-- Står der "fri adgang", er kontoen en af ejernes, og så tester du ikke tælleren — alt
-- virker bare, og du ville tro kvoten var i stykker.

select u.email,
       u.email_confirmed_at is not null                      as kan_logge_ind,
       m.konto_id is not null                                as har_konto,
       k.gratis_boliger,
       brugte_boliger(k.id)                                  as brugt,
       case
         when m.konto_id is null                             then 'INGEN KONTO'
         when u.email_confirmed_at is null                   then 'KAN IKKE LOGGE IND'
         when k.fri_adgang                                   then 'fri adgang (ejer)'
         when k.abonnement_status = 'aktiv'                  then 'abonnement'
         when brugte_boliger(k.id) < k.gratis_boliger
           then (k.gratis_boliger - brugte_boliger(k.id))::text || ' gratis tilbage'
         else 'LUKKET'
       end                                                   as porten,
       k.aftale_version                                      as aftale,
       u.last_sign_in_at
from auth.users u
left join medlemskab m on m.bruger_id = u.id
left join konto k      on k.id = m.konto_id
order by u.created_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. NULSTIL EN TESTER, SÅ HAN KAN KØRE FORFRA
--
-- Sletter hans forbrug og boliger, så tælleren står på nul igen. Udkommenteret med vilje:
-- den skal ikke køre ved et uheld sammen med resten.
--
-- Forbrug først. Ikke fordi det ellers fejler — forbrug.bolig_id er "on delete set null", så
-- det ville gå igennem — men netop DERFOR: sletter man boligerne først, bliver forbrugslinjerne
-- stående med bolig_id = null, og så har man et forbrug man ikke kan henføre til noget.
--
-- Det giver IKKE pengene tilbage hos Luma. Klippene er betalt. Det nulstiller kun vores tæller.
--
--   with k as (
--     select m.konto_id as id from medlemskab m
--     join auth.users u on u.id = m.bruger_id
--     where lower(u.email) = 'lars.engelbrecht@yahoo.dk')
--   delete from forbrug where konto_id = (select id from k);
--
--   with k as (
--     select m.konto_id as id from medlemskab m
--     join auth.users u on u.id = m.bruger_id
--     where lower(u.email) = 'lars.engelbrecht@yahoo.dk')
--   delete from bolig where konto_id = (select id from k);
