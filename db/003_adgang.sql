-- Rundvis — hvem må opgradere, og hvor meget.
--
-- Køres i Supabase under SQL Editor, efter 001 og 002.
--
-- Indtil nu kunne enhver der var logget ind opgradere frit, fordi porten i api/_konto.js kun
-- kræver et abonnement når der FINDES en Stripe-nøgle. Uden den var der ingen bund i det, og
-- hvert klip koster rigtige penge hos Luma.

-- ─────────────────────────────────────────────────────────────────────────────
-- SUPABASE ÆNDRER REGLERNE 30. OKTOBER 2026.
--
-- Fra den dato får nye tabeller i "public" ikke længere automatisk adgang gennem Data API'et,
-- og hele appen taler med databasen over netop det API (alle kald går til /rest/v1/...). De
-- tabeller der allerede ER oprettet beholder deres rettigheder, men et nyt projekt, en preview
-- branch eller en "supabase db reset" bygger skemaet forfra - og så ville intet af det virke.
--
-- Derfor står rettighederne nu i migrationen frem for at blive uddelt automatisk. Det er samme
-- rettigheder som før; forskellen er at de er skrevet ned.
grant usage on schema public to anon, authenticated, service_role;

grant select                         on konto      to anon, authenticated;
grant select                         on medlemskab to anon, authenticated;
grant select, insert                 on bolig      to anon, authenticated;
grant select                         on forbrug    to anon, authenticated;
grant select, insert, update, delete on gemt_video to anon, authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Og for alt hvad der oprettes HEREFTER, så den næste migration ikke skal huske det samme.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Row level security afgør stadig hvilke RÆKKER en bruger ser. En grant åbner tabellen for
-- API'et; politikken i 001 bestemmer indholdet. Begge dele skal være der.

-- ─────────────────────────────────────────────────────────────────────────────
-- ADGANG TIL AT OPGRADERE.
--
-- To kontakter, og de dækker alle tre tilfælde han har brug for:
--
--   fri_adgang = true    ejerne. Ingen grænse.
--   gratis_boliger = 5   testere. Fem boliger, så er der lukket.
--   begge nul            alle andre. Kan lave den gratis 2D-video, men ikke opgradere.
--
-- Grænsen går på BOLIGER og ikke på klip, fordi det er den enhed kunden betaler per i hele
-- resten af modellen (se inkluderede_boliger i 001). En bolig med elleve billeder er én bolig.
alter table konto add column if not exists fri_adgang     boolean not null default false;
alter table konto add column if not exists gratis_boliger int     not null default 0;

comment on column konto.fri_adgang is
  'Ingen graense for opgraderinger. Kun for ejerne.';
comment on column konto.gratis_boliger is
  'Hvor mange boliger kontoen maa opgradere uden abonnement. Taelles mod distinkte boliger i forbrug.';

-- ─────────────────────────────────────────────────────────────────────────────
-- HVOR MANGE BOLIGER HAR KONTOEN BRUGT.
--
-- Som funktion frem for som udregning ude i API'et: tallet afgør om der må bruges penge, og
-- det skal give det samme svar uanset hvem der spørger.
create or replace function brugte_boliger(p_konto uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select count(distinct bolig_id)::int
  from forbrug
  where konto_id = p_konto and bolig_id is not null
$$;

grant execute on function brugte_boliger(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SÆT ADGANGEN. Udfyld mailadresserne og kør.
--
-- Ejerne: fri adgang.
update konto set fri_adgang = true
where id in (
  select m.konto_id from medlemskab m
  join auth.users u on u.id = m.bruger_id
  where lower(u.email) in (
    'akougios@gmail.com'
    -- , 'markus@eksempel.dk'     <- SÆT MARKUS' RIGTIGE MAIL IND
  )
);

-- Testerne: fem boliger hver.
-- update konto set gratis_boliger = 5
-- where id in (
--   select m.konto_id from medlemskab m
--   join auth.users u on u.id = m.bruger_id
--   where lower(u.email) in ('tester1@eksempel.dk', 'tester2@eksempel.dk')
-- );

-- Sådan ser det ud bagefter:
--   select k.navn, k.fri_adgang, k.gratis_boliger, brugte_boliger(k.id) as brugt
--   from konto k order by k.oprettet desc;
