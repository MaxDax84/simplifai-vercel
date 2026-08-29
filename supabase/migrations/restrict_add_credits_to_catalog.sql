-- SICUREZZA: add_credits/apply_promo_and_add_credits accettavano un
-- importo intero libero dal client (nessuna verifica di pagamento reale
-- collegata). Chiunque fosse loggato poteva chiamare
-- supabase.rpc('add_credits', { amount: 999999 }) dalla console del
-- browser e ottenere crediti illimitati gratis, senza nemmeno passare
-- da checkout.html.
--
-- Fix: l'importo non è più un parametro libero, ma viene ricavato
-- server-side da una chiave di pacchetto (package_key) validata contro
-- il catalogo reale (gli stessi 5 pacchetti definiti in checkout.html).
-- Questo non introduce un pagamento reale (il checkout resta simulato,
-- nota già aperta separatamente) ma elimina la possibilità di ottenere
-- importi arbitrari/enormi.

DROP FUNCTION IF EXISTS public.add_credits(integer);
DROP FUNCTION IF EXISTS public.apply_promo_and_add_credits(text, integer);

CREATE OR REPLACE FUNCTION public.add_credits(p_package_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     uuid;
  v_credits     integer;
  v_new_credits integer;
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

  UPDATE profiles
  SET
    credits        = credits + v_credits,
    credits_expiry = now() + interval '12 months',
    updated_at     = now()
  WHERE id = v_user_id
  RETURNING credits INTO v_new_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN v_new_credits;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_promo_and_add_credits(p_code text, p_package_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_credits     integer;
  v_new_credits integer;
BEGIN
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

  UPDATE promo_codes
  SET usage_count = usage_count + 1
  WHERE UPPER(code) = UPPER(p_code)
    AND is_active = true
    AND (valid_until IS NULL OR valid_until > NOW());
  IF NOT FOUND THEN RAISE EXCEPTION 'Codice promo non valido o scaduto.'; END IF;

  -- Nota: il comportamento originale non estendeva credits_expiry qui
  -- (a differenza di add_credits) — mantenuto invariato, non è una
  -- correzione di sicurezza richiesta in questa sessione.
  UPDATE profiles
  SET
    credits    = credits + v_credits,
    updated_at = now()
  WHERE id = auth.uid()
  RETURNING credits INTO v_new_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN v_new_credits;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_credits(text) FROM public;
REVOKE ALL ON FUNCTION public.apply_promo_and_add_credits(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.add_credits(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_promo_and_add_credits(text, text) TO authenticated;
