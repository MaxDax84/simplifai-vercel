-- SICUREZZA: api/groq.js limita le domande gratuite anonime solo se le
-- variabili Upstash sono configurate su Vercel. Verificato che NON lo
-- sono in produzione: il rate limit è quindi "fail-open" sempre attivo,
-- cioè disattivato di fatto. Chiunque, senza account, può oggi chiamare
-- /api/groq senza alcun limite, consumando la chiave Groq a pagamento.
--
-- Fix: un limite server-side che non dipende da un servizio esterno da
-- configurare, usando il DB Supabase già presente. api/groq.js userà
-- Upstash se configurato (invariato), altrimenti questa funzione.

CREATE TABLE IF NOT EXISTS public.anon_rate_limit (
  ip           text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.anon_rate_limit ENABLE ROW LEVEL SECURITY;
-- Nessuna policy per client/anon/authenticated: accesso solo tramite la
-- funzione SECURITY DEFINER sottostante (stesso pattern di promo_codes).

CREATE OR REPLACE FUNCTION public.check_anon_rate_limit(p_ip text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_ip IS NULL OR p_ip = '' OR p_ip = 'unknown' THEN
    RETURN true; -- IP non determinabile: non blocchiamo (non dovrebbe capitare su Vercel)
  END IF;

  INSERT INTO public.anon_rate_limit (ip, count, window_start)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip) DO UPDATE
    SET count = CASE
          WHEN public.anon_rate_limit.window_start < now() - interval '1 year'
            THEN 1
          ELSE public.anon_rate_limit.count + 1
        END,
        window_start = CASE
          WHEN public.anon_rate_limit.window_start < now() - interval '1 year'
            THEN now()
          ELSE public.anon_rate_limit.window_start
        END
  RETURNING count INTO v_count;

  RETURN v_count <= 2;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_anon_rate_limit(text) FROM public;
GRANT EXECUTE ON FUNCTION public.check_anon_rate_limit(text) TO anon, authenticated;
