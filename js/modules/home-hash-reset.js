// On home page refreshes that left a hash in the URL (e.g. after clicking
// "Our story"), strip it and jump to the top so the splash plays cleanly.

export const init = () => {
  if (!document.body.classList.contains("home-page") || !location.hash) return;
  history.replaceState(null, "", location.pathname + location.search);
  setTimeout(() => window.scrollTo(0, 0), 0);
};
