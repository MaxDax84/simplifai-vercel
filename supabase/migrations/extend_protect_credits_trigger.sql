-- SICUREZZA: il trigger trg_protect_credits proteggeva solo la colonna
-- "credits" dalle scritture dirette del client. La policy UPDATE su
-- "profiles" (update_own_profile) non ha WITH CHECK per colonna, quindi
-- un utente loggato poteva comunque fare
-- supabase.from('profiles').update({ credits_expiry: '2099-01-01' })
-- ed estendersi la scadenza crediti a piacimento.
--
-- Fix: la stessa protezione ora copre anche credits_expiry, plan e
-- deleted_at (colonne che devono cambiare solo tramite le RPC
-- SECURITY DEFINER esistenti: add_credits, apply_promo_and_add_credits,
-- soft_delete_user — tutte eseguite come owner della funzione, non come
-- ruolo "authenticated", quindi continuano a funzionare senza modifiche).

CREATE OR REPLACE FUNCTION public.protect_credits_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_user = 'authenticated' THEN
    IF NEW.credits IS DISTINCT FROM OLD.credits THEN
      RAISE EXCEPTION 'direct_credits_write_forbidden';
    END IF;
    IF NEW.credits_expiry IS DISTINCT FROM OLD.credits_expiry THEN
      RAISE EXCEPTION 'direct_credits_expiry_write_forbidden';
    END IF;
    IF NEW.plan IS DISTINCT FROM OLD.plan THEN
      RAISE EXCEPTION 'direct_plan_write_forbidden';
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RAISE EXCEPTION 'direct_deleted_at_write_forbidden';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
