-- Rundvis — giv en testkonto et par gratis boliger, og se tælleren virke.
--
-- Køres i Supabase SQL Editor. Kan køres igen uden skade.
--
-- BAGGRUNDEN. Porten har fire veje, i denne rækkefølge: fri adgang (ejerne), aktivt abonnement,
-- gratis boliger (testere), ellers lukket. Det her sætter en konto på tredje vej. Reglerne selv
-- står i opgraderingsRet i api/_konto.js — det her sætter kun tallet.
--
-- EN BOLIG, IKKE EN VIDEO. Tælleren tæller DISTINKTE bolig_id i forbrug, ikke klip og ikke
-- kørsler. Opgraderer man den samme bolig igen — fx fordi ét klip blev dårligt — tæller den
-- ikke en gang til. Det er med vilje: ellers blev en tester afbrudt midt i sin sidste bolig,
-- med halvdelen af billederne opgraderet.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GIV TESTEREN TO GRATIS BOLIGER
--
-- Kontoen blev oprettet automatisk af triggeren ved_ny_bruger da brugeren meldte sig til, så
-- den findes allerede. Vi går vejen auth.users -> medlemskab -> konto, fordi mailadressen kun
-- står på brugeren.

update konto set gratis_boliger = 2
where id in (
  select m.konto_id from medlemskab m
  join auth.users u on u.id = m.bruger_id
  where u.email = 'lars.engelbrecht@yahoo.dk'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SE AT DET SIDDER
--
-- fri_adgang SKAL være false her. Er den true, er kontoen på vej et (ejerne), og så rammer
-- testen aldrig tælleren — alt ville bare virke, og du ville tro kvoten var i stykker.

select u.email,
       k.id            as konto_id,
       k.fri_adgang,
       k.gratis_boliger,
       k.abonnement_status,
       brugte_boliger(k.id) as brugt_nu
from auth.users u
join medlemskab m on m.bruger_id = u.id
join konto k      on k.id = m.konto_id
where u.email = 'lars.engelbrecht@yahoo.dk';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SÅDAN TESTES DET
--
--   Bolig 1   opgradér en bolig        -> skal virke.  brugt_nu bliver 1
--   samme     opgradér den IGEN        -> skal virke.  brugt_nu bliver stadig 1
--   Bolig 2   ny adresse, opgradér     -> skal virke.  brugt_nu bliver 2
--   Bolig 3   ny adresse, opgradér     -> skal AFVISES med det samme, uden upload
--
-- Det tredje trin er det vigtigste, og det andet er næsten lige så vigtigt: går brugt_nu til 2
-- når man opgraderer den samme bolig to gange, tæller den kørsler i stedet for boliger, og så
-- rammer en tester loftet midt i arbejdet.
--
-- Beskeden ved afvisning skal være "Du har brugt dine 2 gratis boliger. Skriv til
-- akougios@gmail.com for at fortsætte." — altså med tallet og adressen i.

-- Hvilke boliger er brugt, og hvornår:
--
--   select b.adresse, b.id, min(f.tidspunkt) as foerste_klip, count(*) as klip
--   from forbrug f
--   join bolig b on b.id = f.bolig_id
--   where f.konto_id = (
--     select m.konto_id from medlemskab m
--     join auth.users u on u.id = m.bruger_id
--     where u.email = 'lars.engelbrecht@yahoo.dk')
--   group by b.adresse, b.id
--   order by foerste_klip;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. NULSTIL, SÅ TESTEN KAN KØRES IGEN
--
-- Sletter testerens forbrug og boliger, så tælleren står på nul igen. Rør kun denne ene konto.
--
-- Forbrug først. Ikke fordi det ellers fejler — forbrug.bolig_id er "on delete set null", så
-- det ville gå igennem — men netop DERFOR: sletter man boligerne først, bliver forbrugslinjerne
-- stående med bolig_id = null, og så har man et forbrug man ikke kan henføre til noget.
--
--   with k as (
--     select m.konto_id as id from medlemskab m
--     join auth.users u on u.id = m.bruger_id
--     where u.email = 'lars.engelbrecht@yahoo.dk')
--   delete from forbrug where konto_id = (select id from k);
--
--   with k as (
--     select m.konto_id as id from medlemskab m
--     join auth.users u on u.id = m.bruger_id
--     where u.email = 'lars.engelbrecht@yahoo.dk')
--   delete from bolig where konto_id = (select id from k);
--
-- Bemærk at det IKKE giver pengene tilbage hos Luma. Klippene er betalt. Det nulstiller kun
-- hvad vores egen tæller mener.
