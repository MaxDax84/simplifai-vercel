-- ============================================================
--  document_existing_credit_purchase_functions
--
--  Queste tre funzioni esistevano gia' su Supabase (create a mano,
--  usate da checkout.html) ma non erano tracciate nel repo. Lette
--  per intero via pg_get_functiondef() durante l'audit del 2026-08
--  e riportate qui SOLO per documentazione/tracciabilita' — non e'
--  necessario rieseguire questo file (le funzioni sono gia' attive
--  e identiche), ma e' sicuro farlo: CREATE OR REPLACE e' idempotente.
--
--  Tutte e tre SECURITY DEFINER (verificato: non vengono bloccate
--  dalla REVOKE/trigger di spend_credits_server_side.sql /
--  protect_credits_trigger.sql).
-- ============================================================

CREATE OR REPLACE FUNCTION public.add_credits(amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_new_credits int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE profiles
  SET
    credits = credits + amount,
    credits_expiry = now() + interval '12 months',
    updated_at = now()
  WHERE id = v_user_id
  RETURNING credits INTO v_new_credits;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN v_new_credits;
END;
$function$;


CREATE OR REPLACE FUNCTION public.apply_promo_and_add_credits(p_code text, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_new_credits INTEGER;
BEGIN
  UPDATE promo_codes
  SET usage_count = usage_count + 1
  WHERE UPPER(code) = UPPER(p_code)
    AND is_active = true
    AND (valid_until IS NULL OR valid_until > NOW());
  IF NOT FOUND THEN RAISE EXCEPTION 'Codice promo non valido o scaduto.'; END IF;
  UPDATE profiles SET credits = credits + p_amount, updated_at = NOW()
  WHERE id = auth.uid() RETURNING credits INTO v_new_credits;
  RETURN v_new_credits;
END;
$function$;


CREATE OR REPLACE FUNCTION public.validate_promo_code(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_discount INTEGER;
BEGIN
  SELECT discount_percentage INTO v_discount
  FROM promo_codes
  WHERE UPPER(code) = UPPER(p_code)
    AND is_active = true
    AND (valid_until IS NULL OR valid_until > NOW());
  IF NOT FOUND THEN RETURN json_build_object('valid', false); END IF;
  RETURN json_build_object('valid', true, 'discount', v_discount);
END;
$function$;
