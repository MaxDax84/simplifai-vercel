-- ============================================================
--  add_purchases_and_saved_responses
--  1. Tabella purchases  — storico acquisti crediti/piani
--  2. Tabella saved_responses — risposte salvate dall'utente
-- ============================================================

-- ── 1. purchases ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchases (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_key   TEXT        NOT NULL,  -- es. 'pro-monthly', 'mini-boost-once'
  package_name  TEXT        NOT NULL,  -- es. 'PRO', 'PACCHETTO BASE'
  billing_type  TEXT        NOT NULL,  -- 'monthly' | 'yearly' | 'once'
  credits_added INTEGER     NOT NULL DEFAULT 0,
  amount_eur    NUMERIC(10,2),
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchases_select_own"
  ON public.purchases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "purchases_insert_own"
  ON public.purchases FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ── 2. saved_responses ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_responses (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question      TEXT        NOT NULL,
  response_text TEXT        NOT NULL,
  title         TEXT        NOT NULL,  -- uguale alla domanda (troncata a 120 char)
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.saved_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_select_own"
  ON public.saved_responses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "saved_insert_own"
  ON public.saved_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "saved_delete_own"
  ON public.saved_responses FOR DELETE
  USING (auth.uid() = user_id);
