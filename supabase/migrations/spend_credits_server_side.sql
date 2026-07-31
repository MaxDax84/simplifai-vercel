-- ============================================================
--  spend_credits_server_side
--
--  Problema: app.html calcolava "crediti - costo" lato client e
--  scriveva il risultato direttamente su profiles.credits: chiunque
--  poteva scriversi crediti a piacere dalla console del browser.
--
--  Questa migration sposta il consumo crediti server-side:
--    1. spend_credits(p_target_cost, p_length_extra) - valida il
--       costo contro i soli valori reali esistenti in app.html
--       (TARGETS.cost in 1,2,3 - LENGTHS.costExtra in 0,1) e
--       decrementa in modo atomico, solo se il saldo e' sufficiente.
--    2. check_and_expire_credits() - stessa logica di reset a zero
--       per scadenza crediti che oggi app.html faceva con una
--       update diretta.
--
--  Il blocco 3 impedisce ai client di scrivere direttamente la
--  colonna credits. Prima di farlo, verifica da sola (dentro un
--  blocco DO) che add_credits e apply_promo_and_add_credits - usate
--  da checkout.html, non presenti come migration in questo repo -
--  siano gia' SECURITY DEFINER: se non lo sono, la REVOKE le
--  romperebbe, quindi il blocco si ferma con un errore esplicito
--  invece di eseguirla. Esegui l'intero file in un solo colpo: se
--  vedi l'errore "NON sono SECURITY DEFINER", fermati e avvisami
--  con il testo esatto.
-- ============================================================


-- -- 1. Consumo crediti per generare una spiegazione --------------

CREATE OR REPLACE FUNCTION public.spend_credits(p_target_cost integer, p_length_extra integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cost integer;
  v_new_credits integer;
BEGIN
  IF p_target_cost IS NULL OR p_target_cost NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'invalid_target_cost';
  END IF;

  IF p_length_extra IS NULL OR p_length_extra NOT IN (0, 1) THEN
    RAISE EXCEPTION 'invalid_length_extra';
  END IF;

  v_cost := p_target_cost + p_length_extra;

  UPDATE public.profiles
    SET credits = credits - v_cost,
        updated_at = now()
    WHERE id = auth.uid()
      AND credits >= v_cost
  RETURNING credits INTO v_new_credits;

  IF v_new_credits IS NULL THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  RETURN v_new_credits;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.spend_credits(integer, integer) TO authenticated;


-- -- 2. Reset crediti se scaduti (12 mesi) -------------------------

CREATE OR REPLACE FUNCTION public.check_and_expire_credits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_credits integer;
  v_expiry  timestamptz;
BEGIN
  SELECT credits, credits_expiry INTO v_credits, v_expiry
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_expiry IS NOT NULL AND v_expiry < now() AND v_credits > 0 THEN
    UPDATE public.profiles
      SET credits = 0,
          updated_at = now()
      WHERE id = auth.uid();
    RETURN 0;
  END IF;

  RETURN COALESCE(v_credits, 0);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.check_and_expire_credits() TO authenticated;


-- -- 3. Blocca la scrittura diretta della colonna credits ----------
-- Auto-verifica: esegue la REVOKE solo se add_credits e
-- apply_promo_and_add_credits sono gia' SECURITY DEFINER (o non
-- esistono affatto). Altrimenti si ferma con un errore esplicito,
-- senza toccare i permessi, invece di rompere il flusso di acquisto.

DO $check$
DECLARE
  v_unsafe text;
BEGIN
  SELECT string_agg(proname, ', ')
    INTO v_unsafe
  FROM pg_proc
  WHERE proname IN ('add_credits', 'apply_promo_and_add_credits')
    AND prosecdef = false;

  IF v_unsafe IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration fermata: % NON sono SECURITY DEFINER. La REVOKE le romperebbe (checkout.html le chiama direttamente dal client). Sistemale prima con ALTER FUNCTION ... SECURITY DEFINER, poi rilancia solo questo blocco.',
      v_unsafe;
  END IF;

  EXECUTE 'REVOKE UPDATE (credits) ON public.profiles FROM authenticated';
END $check$;
