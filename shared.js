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
  else if (path.includes('contatti'))       key = 'contact';
  document.querySelectorAll('#mainNav a').forEach(function (a) {
    if (a.dataset.nav === key) a.classList.add('nav-active');
  });
})();
