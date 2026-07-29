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

/* ── 6. Condivisione su WhatsApp nel menu hamburger (solo mobile) ──
 * Voce aggiunta in fondo al menu mobile. Usa il link diretto di WhatsApp
 * (wa.me) invece della Web Share API generica: quest'ultima si e' rivelata
 * inaffidabile su alcuni browser/dispositivi (il messaggio non arrivava
 * nemmeno nella chat sul telefono di partenza). wa.me e' il meccanismo
 * ufficiale di WhatsApp per i pulsanti di condivisione ed e' universale.
 * Condivide sempre l'homepage, non la pagina/spiegazione corrente. */
(function () {
  var mobileNav = document.getElementById('mobileNav');
  if (!mobileNav) return;

  var SHARE_URL = 'https://www.simplif-ai.it/';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'share-menu-btn';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><span></span>';
  var labelEl = btn.querySelector('span');

  function updateLabel() {
    labelEl.textContent = window.saiLang() === 'en' ? 'Share on WhatsApp' : 'Condividi su WhatsApp';
  }
  updateLabel();
  document.addEventListener('sai:langchange', updateLabel);

  btn.addEventListener('click', function () {
    document.body.classList.remove('nav-open');
    var msg = (window.saiLang() === 'en'
      ? 'Complex concepts explained simply. Check out Simplif-AI: '
      : 'Concetti complessi spiegati in modo semplice. Guarda Simplif-AI: ') + SHARE_URL;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  });

  mobileNav.appendChild(btn);
})();
