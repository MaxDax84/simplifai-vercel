-- ============================================================
--  fix_profiles_public_read_policy
--
--  Trovata durante l'audit del 2026-08 (documentando le RLS gia'
--  esistenti per questo repo, vedi anche
--  spend_credits_server_side.sql / protect_credits_trigger.sql):
--
--    policyname: "Enable read access for all users"
--    cmd: SELECT
--    roles: {public}
--    qual: true
--
--  In Postgres le policy RLS permissive per lo stesso comando si
--  sommano in OR: questa policy, con qual=true e ruolo public,
--  rendeva leggibile l'INTERA tabella profiles (nome, cognome, data
--  di nascita, citta, crediti...) a chiunque, anche senza login,
--  con la sola chiave anonima pubblica gia' presente nel codice del
--  sito. La policy "select_own_profile" (corretta, limita a
--  auth.uid() = id) esiste gia' in parallelo ma non basta a
--  proteggere se questa resta attiva.
--
--  Nessun flusso legittimo dell'app dipende da questa policy: il
--  client legge sempre e solo il proprio profilo (.eq('id', ...)),
--  e le funzioni SECURITY DEFINER (add_credits, spend_credits, ecc.)
--  girano con i privilegi del proprietario, non soggette a RLS.
-- ============================================================

DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;

-- Verifica: dopo il DROP deve restare SOLO select_own_profile (e
-- l'eventuale altra policy SELECT legittima) come regola SELECT su
-- profiles, mai una con qual = true.
DO $check$
DECLARE
  v_still_open text;
BEGIN
  SELECT string_agg(policyname, ', ')
    INTO v_still_open
  FROM pg_policies
  WHERE tablename = 'profiles'
    AND cmd = 'SELECT'
    AND qual = 'true';

  IF v_still_open IS NOT NULL THEN
    RAISE EXCEPTION
      'Esistono ancora policy SELECT con qual=true su profiles: %. Controllare manualmente.',
      v_still_open;
  END IF;
END $check$;
