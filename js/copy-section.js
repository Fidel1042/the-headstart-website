// copy-section.js — a "Copy section" button on every top-level section of the
// mentor resource hub, so a whole section can be dropped into a Google Doc.
//
// Two flavours go on the clipboard at once:
//   text/html   cleaned-down markup (headings, lists, paragraphs, bold) with
//               every class, id, style and colour stripped. Google Docs reads
//               this and keeps the structure, so bullets stay bullets.
//   text/plain  the same content flattened, for anywhere that wants plain text.
// Copying the page's own markup instead would drag its dark theme, grid classes
// and pill styling into the doc, which is the "weird formatting" problem.

const KEEP = new Set([
  "H1", "H2", "H3", "H4", "P", "UL", "OL", "LI",
  "STRONG", "B", "EM", "I", "BR", "A", "TABLE", "THEAD",
  "TBODY", "TR", "TH", "TD", "BLOCKQUOTE", "CODE", "PRE",
  // Inline elements must be listed too. Anything not named here becomes a DIV,
  // and a DIV is a block, so a heading like "<span>5.</span>LinkedIn" would
  // paste as two lines instead of one.
  "SPAN", "SMALL", "SUP", "SUB", "U", "MARK", "FIGURE", "FIGCAPTION",
]);

// Anything interactive or decorative never belongs in a pasted document.
const DROP = new Set([
  "SCRIPT", "STYLE", "IFRAME", "BUTTON", "SVG", "INPUT",
  "SELECT", "TEXTAREA", "NOSCRIPT", "VIDEO", "AUDIO",
]);

// Images are dropped by default: in most sections they illustrate text that is
// already there, and they bloat the paste. Sections where the picture IS the
// instruction (the networking walkthrough) opt in with data-copy-images.
function clean(node, doc, withImages = false) {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.nodeValue);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  if (DROP.has(node.tagName)) return null;
  if (node.tagName === "IMG" && !withImages) return null;
  if (node.classList && node.classList.contains("copy-section-btn")) return null;
  // Hidden content (collapsed panels, print-only blocks) is not what is on screen.
  if (node.hasAttribute && node.hasAttribute("hidden")) return null;

  if (node.tagName === "IMG") {
    // Google Docs fetches the image itself, so the URL has to be absolute and
    // publicly reachable. Everything else about the tag is layout noise.
    const img = doc.createElement("img");
    img.setAttribute("src", new URL(node.getAttribute("src"), location.href).href);
    if (node.getAttribute("alt")) img.setAttribute("alt", node.getAttribute("alt"));
    return img;
  }

  const tag = KEEP.has(node.tagName) ? node.tagName.toLowerCase() : "div";
  const el = doc.createElement(tag);
  if (tag === "a" && node.getAttribute("href")) {
    el.setAttribute("href", new URL(node.getAttribute("href"), location.href).href);
  }
  node.childNodes.forEach((child) => {
    const c = clean(child, doc, withImages);
    if (c) el.appendChild(c);
  });
  // A wrapper that ended up with nothing in it just adds blank lines. A wrapper
  // holding only an image is not empty, even though it has no text.
  const hasImage = el.querySelector && el.querySelector("img");
  if (!el.textContent.trim() && !hasImage && !["br", "td", "th"].includes(tag)) return null;

  // Section headings hold their number in a span that is spaced apart by CSS
  // ("4." then "Resume"). Pasted text has no CSS, so without this they collide
  // into "4.Resume".
  if (node.tagName === "SPAN" && !/\s$/.test(el.textContent)) {
    el.appendChild(doc.createTextNode(" "));
  }
  return el;
}

// Plain-text version: block elements become line breaks, list items get dashes.
function toText(el, depth = 0) {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) { out += n.nodeValue.replace(/\s+/g, " "); return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const t = n.tagName.toLowerCase();
    if (t === "br") { out += "\n"; return; }
    if (t === "img") { out += `\n[image: ${n.getAttribute("alt") || "screenshot"}]\n`; return; }
    if (t === "li") { out += "\n- " + toText(n, depth + 1).trim(); return; }
    if (["p", "div", "h1", "h2", "h3", "h4", "ul", "ol", "tr", "blockquote", "pre"].includes(t)) {
      out += "\n" + toText(n, depth).trim() + "\n";
      return;
    }
    if (["td", "th"].includes(t)) { out += toText(n, depth).trim() + "\t"; return; }
    out += toText(n, depth);
  });
  return out;
}

const tidy = (s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

async function copySection(section, btn) {
  const doc = document.implementation.createHTMLDocument("");
  const wrap = doc.createElement("div");

  // A section can supply its own copy-ready version in a hidden .copy-source
  // block. The resume section needs this: what it shows is an iframe, and an
  // iframe's contents cannot be read or copied from the page around it, so
  // without this the copy would come back empty.
  const source = section.querySelector(".copy-source");
  const heading = section.querySelector("h2");
  const withImages = section.hasAttribute("data-copy-images");

  if (source) {
    // Keep the section's own h2 so the paste is still labelled.
    if (heading) {
      const h = clean(heading, doc, withImages);
      if (h) wrap.appendChild(h);
    }
    // Walk the children directly: the wrapper itself is hidden, and clean()
    // drops hidden nodes on purpose.
    source.childNodes.forEach((n) => {
      const c = clean(n, doc, withImages);
      if (c) wrap.appendChild(c);
    });
  } else {
    section.childNodes.forEach((n) => {
      const c = clean(n, doc, withImages);
      if (c) wrap.appendChild(c);
    });
  }

  const html = wrap.innerHTML;
  const text = tidy(toText(wrap));

  try {
    // Both flavours together: the target app picks whichever it understands.
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  } catch {
    // Older browsers, or an insecure context: plain text is better than nothing.
    try { await navigator.clipboard.writeText(text); }
    catch { return false; }
  }
  return true;
}

function initCopySections(selector = "main section[id]") {
  document.querySelectorAll(selector).forEach((section) => {
    const heading = section.querySelector("h2");
    // The guard looks for this button's own marker, not its class. The resume
    // section styles its "Save as PDF" and "Open in new tab" controls with the
    // same class, and checking the class made this function think it had
    // already run there, so section 4 was the one section with no Copy button.
    if (!heading || section.querySelector("[data-copy-section]")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-section-btn";
    btn.dataset.copySection = "";
    btn.textContent = "Copy section";
    btn.setAttribute("aria-label", `Copy the ${heading.textContent.trim()} section`);

    btn.addEventListener("click", async () => {
      const ok = await copySection(section, btn);
      btn.textContent = ok ? "Copied" : "Press Ctrl+C";
      btn.classList.toggle("is-copied", ok);
      setTimeout(() => {
        btn.textContent = "Copy section";
        btn.classList.remove("is-copied");
      }, 2000);
    });

    heading.appendChild(btn);
  });
}

// Plain script, not an ES module, and loaded with a relative path. Modules are
// blocked by CORS when a page is opened straight off disk, and an absolute
// "/js/..." only resolves when the site is served from its root. This form
// works from a file, a subfolder, and the live site alike.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initCopySections());
} else {
  initCopySections();
}
