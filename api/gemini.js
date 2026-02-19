<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Checkout – SimplifAI</title>

  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #f8fafc; }
    .ai-gradient { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); }
  </style>
</head>

<body class="min-h-screen">
  <nav class="w-full h-16 flex items-center justify-between px-6 md:px-10 border-b bg-white/80 backdrop-blur-md sticky top-0 z-50">
    <a href="/" class="flex items-center gap-2">
      <div class="ai-gradient w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm">⚡</div>
      <span class="text-xl font-extrabold tracking-tight text-gray-900">
        SimplifAI <span class="text-indigo-600">Clone</span>
      </span>
    </a>
    <a href="/#pricing" class="text-sm font-semibold text-gray-600 hover:text-indigo-600">Torna ai prezzi</a>
  </nav>

  <main class="max-w-5xl mx-auto px-4 py-12">
    <div class="text-center mb-10">
      <span class="inline-block py-1 px-3 rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-3">
        Checkout (Mock)
      </span>
      <h1 class="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight">
        Sblocca più generazioni e risposte più lunghe
      </h1>
      <p class="text-gray-500 mt-3">
        Questa è una pagina dimostrativa. Più avanti collegheremo Stripe.
      </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- PRO -->
      <div class="bg-white rounded-3xl shadow-2xl border-2 border-indigo-200 p-7">
        <h2 class="text-lg font-extrabold text-gray-900">PRO</h2>
        <div class="mt-3 text-4xl font-extrabold text-gray-900">€14,99</div>
        <div class="text-sm text-gray-500">al mese</div>

        <ul class="mt-6 space-y-3 text-sm text-gray-700">
          <li>✅ fino a <b>150 richieste/giorno</b></li>
          <li>✅ risposte fino a <b>~4500 token</b></li>
          <li>✅ meno attese (priorità)</li>
          <li>✅ output più lungo per Esperto/Scienziato</li>
        </ul>

        <button
          class="mt-7 w-full px-4 py-3 rounded-2xl ai-gradient text-white font-semibold hover:scale-[1.01] transition shadow-lg"
          onclick="alert('Mock checkout: qui collegheremo Stripe 🙂')"
          type="button"
        >
          Continua (mock)
        </button>
      </div>

      <!-- BUSINESS -->
      <div class="bg-white rounded-3xl shadow-xl border border-gray-100 p-7">
        <h2 class="text-lg font-extrabold text-gray-900">BUSINESS</h2>
        <div class="mt-3 text-4xl font-extrabold text-gray-900">€79,99</div>
        <div class="text-sm text-gray-500">al mese</div>

        <ul class="mt-6 space-y-3 text-sm text-gray-700">
          <li>🏢 richieste elevate per team</li>
          <li>🏢 risposte fino a <b>~8000 token</b></li>
          <li>✅ supporto prioritario</li>
          <li>✅ opzioni team (in arrivo)</li>
        </ul>

        <button
          class="mt-7 w-full px-4 py-3 rounded-2xl bg-gray-900 text-white font-semibold hover:bg-gray-800 transition"
          onclick="alert('Mock: contatto commerciale 🙂')"
          type="button"
        >
          Richiedi demo (mock)
        </button>
      </div>
    </div>

    <div class="mt-10 text-center text-sm text-gray-500">
      Vuoi tornare all’app? <a href="/" class="font-semibold text-indigo-600 hover:underline">Vai alla home</a>
    </div>
  </main>
</body>
</html>
