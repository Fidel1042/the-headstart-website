// pwa.js — registers the mentor portal service worker.
// Classic script (not a module) so the auth pages can use it too.
(function () {
  if (!("serviceWorker" in navigator)) return;
  // Skip on localhost so local previews never fight a cached copy.
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/mentor-portal/sw.js", { scope: "/mentor-portal/" })
      .catch(function () { /* offline support is optional, never block the page */ });
  });
})();
