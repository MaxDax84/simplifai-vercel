-- SICUREZZA: api/send-email.js non aveva alcun limite di frequenza. Un
-- utente autenticato poteva richiamarlo in loop (console/curl con il
-- proprio JWT) inondando la propria casella e consumando la quota
-- Resend dell'account senza alcun freno.
--
-- Fix: limite server-side per utente+tipo email, tramite funzione
-- SECURITY DEFINER (stesso pattern di check_anon_rate_limit).

CREATE TABLE IF NOT EXISTS public.email_rate_limit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL,
  email_type text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_rate_limit_lookup
  ON public.email_rate_limit (user_id, email_type, sent_at);

ALTER TABLE public.email_rate_limit ENABLE ROW LEVEL SECURITY;
-- Nessuna policy per client: accesso solo tramite la funzione sottostante.

CREATE OR REPLACE FUNCTION public.check_email_rate_limit(p_type text, p_max integer, p_window_minutes integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_count   integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.email_rate_limit
  WHERE user_id = v_user_id
    AND email_type = p_type
    AND sent_at > now() - (p_window_minutes || ' minutes')::interval;

  IF v_count >= p_max THEN
    RETURN false;
  END IF;

  INSERT INTO public.email_rate_limit (user_id, email_type) VALUES (v_user_id, p_type);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_email_rate_limit(text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.check_email_rate_limit(text, integer, integer) TO authenticated;
