-- ============================================================
--  fix_promo_code_abuse
--
--  Problema (audit 2026-08-30): apply_promo_and_add_credits(p_code,
--  p_package_key) e' SECURITY DEFINER e chiamabile da qualsiasi utente
--  autenticato (usata da checkout.html). Controllava SOLO che il
--  codice fosse is_active e non scaduto, ma non esisteva nessun
--  limite di utilizzo: ne' per utente (un utente poteva richiamarla
--  in loop dalla console del browser con lo stesso codice), ne'
--  totale (la tabella promo_codes non ha nemmeno una colonna
--  max_uses - usage_count veniva incrementato ma mai controllato).
--  Risultato: chiunque conoscesse un codice promo attivo poteva
--  ottenere crediti illimitati gratis, per qualunque pacchetto fino
--  a "max-once" (1400 crediti a chiamata).
--
--  Verificato live (2026-08-30): i due codici esistenti
--  (BENVENUTO20, Freeforu) sono entrambi gia' scaduti (valid_until
--  nel passato), quindi non sfruttabile in questo momento - ma il
--  bug e' nella funzione stessa e sarebbe immediatamente sfruttabile
--  al primo nuovo codice promo attivo creato.
--
--  Fix:
--    1. Nuova tabella promo_redemptions: un vincolo UNIQUE
--       (promo_code_id, user_id) impedisce a un utente di
--       riscattare due volte lo stesso codice. Accessibile solo
--       tramite la funzione SECURITY DEFINER, nessun grant diretto
--       a client.
--    2. Colonna max_uses su promo_codes (nullable = nessun tetto,
--       comportamento invariato per i codici esistenti) per poter
--       impostare un tetto totale sui prossimi codici promo, se
--       serve.
--    3. apply_promo_and_add_credits riscritta: blocca la riga del
--       codice con FOR UPDATE (evita race condition tra chiamate
--       concorrenti sullo stesso codice), controlla max_uses, poi
--       inserisce la redemption PRIMA di accreditare i crediti - se
--       l'utente ha gia' usato quel codice, l'INSERT fallisce per
--       violazione del vincolo UNIQUE e la funzione solleva
--       un'eccezione senza accreditare nulla.
-- ============================================================


-- 1. Tabella redemption per utente ---------------------------------

CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id            uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (promo_code_id, user_id)
);

ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;
-- Nessuna policy = nessun accesso diretto da client (ne' anon ne'
-- authenticated): la tabella e' scritta solo dalla funzione
-- SECURITY DEFINER sotto, che gira come owner e bypassa RLS.
REVOKE ALL ON public.promo_redemptions FROM public, anon, authenticated;


-- 2. Tetto totale opzionale per codice -------------------------------

ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS max_uses integer;


-- 3. Funzione corretta ------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_promo_and_add_credits(p_code text, p_package_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     uuid;
  v_credits     integer;
  v_new_credits integer;
  v_promo_id    uuid;
  v_max_uses    integer;
  v_usage_count integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_credits := CASE p_package_key
    WHEN 'mini-once' THEN 25
    WHEN 'base-once' THEN 80
    WHEN 'plus-once' THEN 200
    WHEN 'pro-once'  THEN 500
    WHEN 'max-once'  THEN 1400
    ELSE NULL
  END;

  IF v_credits IS NULL THEN
    RAISE EXCEPTION 'invalid_package';
  END IF;

  SELECT id, max_uses, usage_count
    INTO v_promo_id, v_max_uses, v_usage_count
  FROM promo_codes
  WHERE UPPER(code) = UPPER(p_code)
    AND is_active = true
    AND (valid_until IS NULL OR valid_until > NOW())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Codice promo non valido o scaduto.';
  END IF;

  IF v_max_uses IS NOT NULL AND v_usage_count >= v_max_uses THEN
    RAISE EXCEPTION 'Codice promo esaurito.';
  END IF;

  BEGIN
    INSERT INTO promo_redemptions (promo_code_id, user_id) VALUES (v_promo_id, v_user_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Hai gia'' utilizzato questo codice promo.';
  END;

  UPDATE promo_codes SET usage_count = usage_count + 1 WHERE id = v_promo_id;

  UPDATE profiles
  SET
    credits    = credits + v_credits,
    updated_at = now()
  WHERE id = v_user_id
  RETURNING credits INTO v_new_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN v_new_credits;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_promo_and_add_credits(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_promo_and_add_credits(text, text) TO authenticated;
