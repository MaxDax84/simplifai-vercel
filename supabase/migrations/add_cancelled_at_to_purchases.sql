-- Aggiunge colonna cancelled_at a purchases
-- e policy UPDATE per permettere all'utente di annullare il proprio abbonamento

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE POLICY "purchases_update_own"
  ON public.purchases FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
