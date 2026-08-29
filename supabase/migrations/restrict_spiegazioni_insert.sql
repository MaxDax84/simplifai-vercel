-- SICUREZZA: la policy INSERT su "spiegazioni" (tabella pubblica mostrata
-- su /spiegazioni) controllava solo "response_text non vuoto". Chiunque,
-- anche senza account, poteva chiamare direttamente l'API REST di
-- Supabase con la chiave anon (pubblica in ogni pagina) e inserire righe
-- arbitrarie spacciate per "spiegazioni generate da Simplif-AI" — spam,
-- contenuti offensivi, o righe enormi senza alcun limite.
--
-- Fix: richiede un utente autenticato, blocca lo spoofing di user_id
-- (deve essere null o il proprio id) e impone limiti di lunghezza
-- coerenti con quelli già applicati lato client/server in api/groq.js.

DROP POLICY IF EXISTS spiegazioni_insert ON public.spiegazioni;

CREATE POLICY spiegazioni_insert ON public.spiegazioni
FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (user_id IS NULL OR user_id = auth.uid())
  AND response_text IS NOT NULL
  AND length(response_text) > 0
  AND length(response_text) <= 50000
  AND (query IS NULL OR length(query) <= 500)
);
