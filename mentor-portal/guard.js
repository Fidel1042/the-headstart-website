// One-line auth guard for protected pages.
// Usage in a protected page's <head>:
//   <style>html:not(.auth-ok) body { display: none; }</style>
//   <script type="module" src="/mentor-portal/guard.js"></script>
import { requireAuth } from "/mentor-portal/auth.js";
requireAuth();
