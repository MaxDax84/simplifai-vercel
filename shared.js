/**
 * shared.js – Logica UI comune a tutte le pagine Simplif-AI.
 * Caricato con defer: si esegue dopo il parsing HTML, prima di DOMContentLoaded.
 *
 * Contiene:
 *  1. Mobile nav toggle
 *  2. Sticky header
 *  3. Theme toggle (☀️ / 🌙)
 *  4. Navbar active (rilevamento automatico dal pathname)
 */

/* ── 1. Mobile nav ── */
(function () {
  var toggle    = document.getElementById('navToggle');
  var mobileNav = document.getElementById('mobileNav');
  if (!toggle || !mobileNav) return;
  toggle.addEventListener('click', function () {
    document.body.classList.toggle('nav-open');
  });
  mobileNav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      document.body.classList.remove('nav-open');
    });
  });
})();

/* ── 2. Sticky header ── */
(function () {
  var h = document.querySelector('header');
  if (!h) return;
  window.addEventListener('scroll', function () {
    h.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });
})();

/* ── 3. Theme toggle ── */
(function () {
  var btn = document.getElementById('themeBtn');
  if (!btn) return;
  function applyTheme(dark) {
    if (dark) { document.documentElement.removeAttribute('data-theme'); }
    else      { document.documentElement.setAttribute('data-theme', 'light'); }
    try { localStorage.setItem('sai_theme', dark ? 'dark' : 'light'); } catch(_) {}
  }
  var isDark = localStorage.getItem('sai_theme') !== 'light';
  applyTheme(isDark);
  btn.addEventListener('click', function () {
    isDark = !isDark;
    applyTheme(isDark);
  });
})();

/* ── 4. Navbar active ── */
(function () {
  var path = location.pathname.toLowerCase();
  var key  = 'home';
  if      (path.includes('/app'))           key = 'app';
  else if (path.includes('come-funziona'))  key = 'how';
  else if (path.includes('prezzi'))         key = 'pricing';
  else if (path.includes('checkout'))       key = 'pricing';
  else if (path.includes('profilo'))        key = 'profile';
  else if (path.includes('spiegazioni'))    key = 'spiegazioni';
  else if (path.includes('contatti'))       key = 'contact';
  document.querySelectorAll('#mainNav a').forEach(function (a) {
    if (a.dataset.nav === key) a.classList.add('nav-active');
  });
})();

/* ── 5. Lingua IT/EN ──
 * Traduzione client-side: gli elementi con data-i18n(-html|-placeholder|-title|-aria)
 * vengono scambiati con le stringhe di window.SAI_I18N_EN (dizionario definito
 * inline in ogni pagina) quando la lingua attiva è 'en'. Il testo italiano
 * originale viene messo in cache sull'elemento stesso al primo giro, cosi'
 * il toggle non richiede reload. Per i contenuti generati via JS (liste,
 * card…) le pagine possono chiamare window.saiT(key, testoItaliano) al
 * render e riascoltare l'evento 'sai:langchange' per ridisegnarli. */
(function () {
  var ATTR_MAP = {
    'data-i18n-placeholder': 'placeholder',
    'data-i18n-title': 'title',
    'data-i18n-aria': 'aria-label',
    'data-i18n-label': 'label'
  };

  function dict() { return window.SAI_I18N_EN || {}; }

  function applyI18n(lang) {
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.lang = lang;
    var d = dict();

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      if (!el.hasAttribute('data-i18n-it')) el.setAttribute('data-i18n-it', el.textContent);
      var key = el.getAttribute('data-i18n');
      el.textContent = (lang === 'en' && d[key] !== undefined) ? d[key] : el.getAttribute('data-i18n-it');
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      if (!el.hasAttribute('data-i18n-it-html')) el.setAttribute('data-i18n-it-html', el.innerHTML);
      var key = el.getAttribute('data-i18n-html');
      el.innerHTML = (lang === 'en' && d[key] !== undefined) ? d[key] : el.getAttribute('data-i18n-it-html');
    });

    Object.keys(ATTR_MAP).forEach(function (dataAttr) {
      var realAttr  = ATTR_MAP[dataAttr];
      var cacheAttr = 'data-i18n-it-' + realAttr.replace('aria-label', 'aria');
      document.querySelectorAll('[' + dataAttr + ']').forEach(function (el) {
        if (!el.hasAttribute(cacheAttr)) el.setAttribute(cacheAttr, el.getAttribute(realAttr) || '');
        var key = el.getAttribute(dataAttr);
        el.setAttribute(realAttr, (lang === 'en' && d[key] !== undefined) ? d[key] : el.getAttribute(cacheAttr));
      });
    });

    document.dispatchEvent(new CustomEvent('sai:langchange', { detail: { lang: lang } }));
  }

  /* saiLang/saiT possono già esistere: alcune pagine (es. app.html) li definiscono
   * prima, nell'head, perché servono già durante il rendering iniziale (prima che
   * questo script deferred venga eseguito). Qui li definiamo solo se mancano. */
  if (!window.saiLang) {
    window.saiLang = function () {
      try { return localStorage.getItem('sai_lang') || 'it'; } catch (_) { return 'it'; }
    };
  }
  if (!window.saiT) {
    window.saiT = function (key, fallback) {
      if (window.saiLang() === 'en') {
        var d = dict();
        if (d[key] !== undefined) return d[key];
      }
      return fallback !== undefined ? fallback : key;
    };
  }

  var lang = window.saiLang();
  applyI18n(lang);

  var btn = document.getElementById('langBtn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    lang = lang === 'it' ? 'en' : 'it';
    try { localStorage.setItem('sai_lang', lang); } catch (_) {}
    applyI18n(lang);
  });
})();

/* ── 6. Condivisione sito nel menu hamburger (solo mobile) ──
 * Voce aggiunta in fondo al menu mobile, creata via JS solo se il
 * browser supporta navigator.share(): niente pulsante morto sui browser
 * che non la supportano. Il menu hamburger e' gia' mobile-only, quindi
 * non serve altra logica di visibilita'. Condivide sempre l'homepage,
 * non la pagina/spiegazione corrente. */
(function () {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return;
  var mobileNav = document.getElementById('mobileNav');
  if (!mobileNav) return;

  var SHARE_URL = 'https://www.simplif-ai.it/';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'share-menu-btn';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg><span></span>';
  var labelEl = btn.querySelector('span');

  function updateLabel() {
    labelEl.textContent = window.saiLang() === 'en' ? 'Share' : 'Condividi';
  }
  updateLabel();
  document.addEventListener('sai:langchange', updateLabel);

  btn.addEventListener('click', function () {
    document.body.classList.remove('nav-open');
    navigator.share({
      title: 'Simplif-AI',
      text: window.saiLang() === 'en'
        ? 'Complex concepts explained simply. Check out Simplif-AI:'
        : 'Concetti complessi spiegati in modo semplice. Guarda Simplif-AI:',
      url: SHARE_URL
    }).catch(function () { /* utente ha annullato o share non riuscita: nessun errore da mostrare */ });
  });

  mobileNav.appendChild(btn);
})();
