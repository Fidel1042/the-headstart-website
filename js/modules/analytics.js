export function gtagEvent(name, params) {
  // hsTrack (js/attribution.js) attaches first-touch source to every event.
  // Fall back to raw gtag if attribution.js failed to load.
  if (typeof window.hsTrack === 'function') {
    window.hsTrack(name, params);
    return;
  }
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
}

function locationLabel(el) {
  if (el.closest('.nav')) return 'nav';
  if (el.closest('.pricing-box')) return 'pricing';
  if (el.closest('.conversion-cta')) return 'job_alerts_cta';
  if (el.closest('.hero-primary-cta')) return 'hero';
  if (el.closest('.mobile-sticky-cta')) return 'mobile_sticky';
  return 'page';
}

export const init = () => {
  // "Free Career Call" and "Book a free call" CTAs across all pages
  document.querySelectorAll('.nav-cta--gold, .pricing-box__cta, .cta-primary').forEach(el => {
    el.addEventListener('click', () => {
      gtagEvent('cta_click', {
        link_text: el.textContent.trim().replace(/\s+/g, ' '),
        location: locationLabel(el),
        page: window.location.pathname
      });
    });
  });

  // Booking funnel start. Fires when someone on any page clicks through to
  // the discovery call, giving us the denominator for booking rate.
  document.querySelectorAll('a[href*="/discovery-call"], a[href*="discovery-call.html"]').forEach(el => {
    el.addEventListener('click', () => {
      const fromPage = window.location.pathname;
      gtagEvent('booking_start', {
        location: locationLabel(el),
        from_page: fromPage
      });
      // Remembered so the eventual Calendly booking knows which page the
      // journey actually started on. Without this we can count bookings and
      // count main-page visits, but never tie one to the other.
      try {
        sessionStorage.setItem('hs_booking_from', fromPage);
      } catch (e) { /* storage blocked, fall back to "unknown" */ }
    });
  });

  // Blog listing "Read article" clicks
  document.querySelectorAll('.blog-list-item .btn').forEach(el => {
    el.addEventListener('click', () => {
      const article = el.closest('.blog-list-item');
      const h2 = article && article.querySelector('h2');
      gtagEvent('blog_article_click', {
        article_title: h2 ? h2.textContent.trim() : ''
      });
    });
  });
};
