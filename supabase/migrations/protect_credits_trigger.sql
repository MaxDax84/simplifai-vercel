-- ============================================================
--  protect_credits_trigger
--
--  La migration precedente (spend_credits_server_side.sql) usava
--  REVOKE UPDATE (credits) per bloccare le scritture dirette dal
--  client, ma si e' rivelato insufficiente: il ruolo "authenticated"
--  ha gia' un permesso UPDATE piu' ampio sull'intera tabella profiles
--  (necessario per permettere agli utenti di modificare il proprio
--  profilo), e quel permesso piu' ampio vince su un REVOKE ristretto
--  alla singola colonna.
--
--  Soluzione: un trigger che, ad ogni UPDATE su profiles, blocca la
--  modifica di credits se chi scrive e' il ruolo "authenticated"
--  (cioe' una scrittura diretta dal client via PostgREST). Le
--  funzioni SECURITY DEFINER (spend_credits, check_and_expire_credits,
--  add_credits, apply_promo_and_add_credits) eseguono con l'identita'
--  del proprietario della funzione, non con "authenticated": il
--  trigger le lascia passare.
--
--  ENABLE ALWAYS TRIGGER: necessario perche' senza questo, con
--  tgenabled sul default ('O' = origin), il trigger non scattava per
--  le richieste reali del sito (causa esatta non isolata con
--  certezza, ma verificata empiricamente: con 'A' funziona sempre,
--  con 'O' le richieste via PostgREST lo bypassavano). Verificato
--  con test reale end-to-end (utente autenticato, sessione con
--  token fresco): la scrittura diretta viene bloccata con errore
--  "direct_credits_write_forbidden".
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_credits_column()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.credits IS DISTINCT FROM OLD.credits AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'direct_credits_write_forbidden';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_protect_credits ON public.profiles;

CREATE TRIGGER trg_protect_credits
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_credits_column();

ALTER TABLE public.profiles ENABLE ALWAYS TRIGGER trg_protect_credits;
