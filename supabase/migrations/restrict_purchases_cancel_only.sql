-- La policy purchases_update_own (add_cancelled_at_to_purchases.sql) permette
-- update su QUALSIASI colonna della propria riga in purchases, non solo cancelled_at
-- com'era l'intento originale. Un utente autenticato puo' riscrivere il proprio
-- storico acquisti (credits_added, amount_eur, package_name) via client diretto.
-- Fix: RPC dedicata che tocca solo cancelled_at, drop della policy larga.

CREATE OR REPLACE FUNCTION public.cancel_purchase(purchase_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.purchases
  SET cancelled_at = now()
  WHERE id = purchase_id
    AND user_id = auth.uid()
    AND cancelled_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_purchase(UUID) TO authenticated;

DROP POLICY IF EXISTS "purchases_update_own" ON public.purchases;
