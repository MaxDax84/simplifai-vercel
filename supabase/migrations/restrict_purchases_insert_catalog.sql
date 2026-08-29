-- SICUREZZA: purchases_insert_own permetteva di inserire un log di
-- acquisto con package_name/credits_added/amount_eur completamente
-- arbitrari (non altera il saldo crediti reale, protetto altrove, ma
-- falsifica lo storico acquisti mostrato in profilo.html).
--
-- Fix: il log deve corrispondere a uno dei pacchetti reali del
-- catalogo (stesso elenco usato in add_credits). amount_eur resta
-- flessibile verso il basso per permettere gli sconti promo applicati
-- lato client, ma non può superare il prezzo pieno del pacchetto né
-- essere negativo.

DROP POLICY IF EXISTS purchases_insert_own ON public.purchases;

CREATE POLICY purchases_insert_own ON public.purchases
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND package_key IN ('mini-once', 'base-once', 'plus-once', 'pro-once', 'max-once')
  AND credits_added = CASE package_key
        WHEN 'mini-once' THEN 25
        WHEN 'base-once' THEN 80
        WHEN 'plus-once' THEN 200
        WHEN 'pro-once'  THEN 500
        WHEN 'max-once'  THEN 1400
      END
  AND amount_eur >= 0
  AND amount_eur <= CASE package_key
        WHEN 'mini-once' THEN 1.99
        WHEN 'base-once' THEN 4.99
        WHEN 'plus-once' THEN 7.99
        WHEN 'pro-once'  THEN 14.99
        WHEN 'max-once'  THEN 34.99
      END
);
