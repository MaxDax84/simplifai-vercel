-- ============================================================
--  handle_new_user v2
--  Scatta ad ogni INSERT su auth.users (trigger on_auth_user_created).
--  • Assegna 10 crediti di benvenuto con scadenza 12 mesi.
--  • Anti-abuso: se l'email è già in processed_welcomes
--    (account precedentemente eliminato con soft_delete_user),
--    assegna 0 crediti invece di 10.
--  • ON CONFLICT (id) per sicurezza in caso di doppio fire.
-- ============================================================

-- 1. Aggiorna la funzione esistente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _credits integer := 10;
BEGIN
  -- Anti-abuso: email già usata in passato → 0 crediti
  IF EXISTS (
    SELECT 1 FROM public.processed_welcomes WHERE email = NEW.email
  ) THEN
    _credits := 0;
  ELSE
    -- Prima registrazione: segna l'email come processata
    INSERT INTO public.processed_welcomes (email, created_at)
    VALUES (NEW.email, now())
    ON CONFLICT (email) DO NOTHING;
  END IF;

  -- Crea (o aggiorna se esiste già) il profilo
  INSERT INTO public.profiles (id, credits, credits_expiry, updated_at)
  VALUES (
    NEW.id,
    _credits,
    now() + INTERVAL '1 year',
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET credits        = EXCLUDED.credits,
        credits_expiry = EXCLUDED.credits_expiry,
        updated_at     = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;


-- 2. Ricrea il trigger (DROP + CREATE è idempotente)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- 3. Elimina apply_welcome_credits (incompleta, non più usata)
DROP FUNCTION IF EXISTS public.apply_welcome_credits();
