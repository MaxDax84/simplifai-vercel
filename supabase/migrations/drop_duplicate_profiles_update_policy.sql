-- "Enable update for users based on id" e' una policy UPDATE su profiles
-- identica a update_own_profile (stessa condizione auth.uid() = id), creata
-- a mano nel dashboard prima che update_own_profile fosse tracciata come
-- migration. Nessun rischio di sicurezza, solo ridondanza da pulire.

DROP POLICY IF EXISTS "Enable update for users based on id" ON public.profiles;
