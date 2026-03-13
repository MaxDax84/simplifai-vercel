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

/* ── 5. Logo SVG injection ── */
(function(){
  var SVG = '<svg viewBox="0 0 52 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'

    /* ── 5 ellissi ruotate (groviglio "atomico") ── */
    + '<ellipse cx="12" cy="16" rx="9.5" ry="5.2" stroke="#00d4ff" stroke-width="1.25" opacity=".82"/>'
    + '<ellipse cx="12" cy="16" rx="9.5" ry="5.2" transform="rotate(36 12 16)"  stroke="#00d4ff" stroke-width="1.15" opacity=".72"/>'
    + '<ellipse cx="12" cy="16" rx="9.5" ry="5.2" transform="rotate(72 12 16)"  stroke="#00d4ff" stroke-width="1.1"  opacity=".62"/>'
    + '<ellipse cx="12" cy="16" rx="9.5" ry="5.2" transform="rotate(108 12 16)" stroke="#00d4ff" stroke-width="1.1"  opacity=".68"/>'
    + '<ellipse cx="12" cy="16" rx="9.5" ry="5.2" transform="rotate(144 12 16)" stroke="#00d4ff" stroke-width="1.2"  opacity=".76"/>'

    /* ── Nodi (punti di connessione) ── */
    + '<circle cx="12"  cy="10.8" r="1.35" fill="#00d4ff"/>'
    + '<circle cx="2.5" cy="16"   r="1.3"  fill="#00d4ff" opacity=".9"/>'
    + '<circle cx="12"  cy="21.2" r="1.3"  fill="#00d4ff" opacity=".88"/>'
    + '<circle cx="17"  cy="8.2"  r="1.2"  fill="#00d4ff" opacity=".82"/>'
    + '<circle cx="17"  cy="23.8" r="1.2"  fill="#00d4ff" opacity=".78"/>'

    /* ── Linee di convergenza (destra del groviglio → diamante) ── */
    + '<path d="M21.5 12.5 C25 12.5 28 14.2 30.5 16" stroke="#00d4ff" stroke-width="1.1" opacity=".72"/>'
    + '<path d="M21.5 19.5 C25 19.5 28 17.8 30.5 16" stroke="#00d4ff" stroke-width="1.1" opacity=".72"/>'
    + '<line x1="21.5" y1="16" x2="30.5" y2="16" stroke="#00d4ff" stroke-width="1.35" opacity=".88"/>'

    /* ── Diamante ── */
    + '<path d="M30.5 13 L34 16 L30.5 19 L27 16 Z" stroke="#00d4ff" stroke-width="1.5" fill="none"/>'

    /* ── Linea pulita di uscita ── */
    + '<line x1="34" y1="16" x2="50.5" y2="16" stroke="#00d4ff" stroke-width="2.2" stroke-linecap="round"/>'

    + '</svg>';

  document.querySelectorAll('.logo').forEach(function(el){ el.innerHTML = SVG; });
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
