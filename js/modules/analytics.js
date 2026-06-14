export function gtagEvent(name, params) {
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
