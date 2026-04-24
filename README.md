# Headstart Mentoring — Website

The public-facing website for [Headstart Mentoring](https://theheadstartmentoring.com), a 1-on-1 online mentoring platform for international students navigating the Australian graduate job market.

Hosted on **Netlify**, deployed automatically from the `home` branch.

---

## Project Structure

```
/
├── index.html              # Homepage
├── style.css               # Global styles
├── script.js               # Global scripts
├── sitemap.xml             # XML sitemap for search engines
├── robots.txt              # Crawler instructions
├── _redirects              # Netlify URL routing rules
├── images/                 # Shared image assets
└── html/                   # All secondary pages
    ├── services.html
    ├── pricing.html
    ├── mentors.html
    ├── careers.html
    ├── discovery-call.html
    ├── mentor-application.html
    ├── mentor-role.html
    ├── mentee-signup.html
    ├── mentee-agreement.html
    ├── mentor-onboarding.html          # Mentor onboarding portal (private)
    ├── mentor-onboarding-*.html        # Individual onboarding modules
    ├── blog/index.html                 # Blog index
    ├── does-your-degree-matter-*.html  # Blog post 1
    ├── australian-graduate-job-*.html  # Blog post 2
    └── ...
```

---

## Deployment

- **Host:** Netlify
- **Branch:** `home`
- Pushing to `home` triggers an automatic deploy
- URL routing is handled via `_redirects` (no file extensions in public URLs)
- Forms are processed via Getform

---

## Development Notes

- Plain HTML, CSS, and vanilla JS — no build step, no frameworks
- All pages share the same design system: black background, gold gradient accents, grain overlay
- `style.css` contains global styles; individual pages may include scoped `<style>` blocks for page-specific components
- Images should be optimised before committing — no automated compression pipeline

---

## Branch

Active development happens on the `home` branch. `main` is not used for deployment.
