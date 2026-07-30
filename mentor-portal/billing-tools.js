// billing-tools.js — the non-money utilities on the billing screen:
// schema check, card links, package usage and the mentee audit.
// Split from billing.js so the charging code stays small and readable.

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

// Set by billing.js once the owner is known.
let ADMIN_EMAIL = "";
export function setToolsAdmin(email) { ADMIN_EMAIL = email; loadCardMentees(); }

// ── Schema check ──
window.runSchemaCheck = async function (btn) {
  const out = document.getElementById("schema-out");
  btn.disabled = true; const original = btn.textContent; btn.textContent = "Checking…";

  let data;
  if (isLocal) {
    data = { allOk: false, failCount: 1, groups: [
      { table: "Session Log", checks: [
        { label: "Field: Mentee Record ID", ok: true, detail: "" },
        { label: "Field: Amount Due", ok: true, detail: "" },
        { label: "Payment Status option: Pending", ok: false, detail: "add this dropdown option" },
        { label: "Payment Status option: Charged", ok: true, detail: "" },
      ] },
      { table: "Mentees", checks: [
        { label: "Field: Stripe Customer ID", ok: true, detail: "" },
        { label: "Field: Session Price", ok: true, detail: "" },
      ] },
    ] };
  } else {
    try {
      const res = await fetch("/.netlify/functions/schema-check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminEmail: ADMIN_EMAIL }),
      });
      data = await res.json();
    } catch (e) {
      out.innerHTML = `<span style="color:#e05050;">${e.message}</span>`;
      btn.disabled = false; btn.textContent = original; return;
    }
  }

  if (data.error) {
    out.innerHTML = `<span style="color:#e05050;">${data.error}</span>`;
    document.title = "⚠ Billing – schema unreadable";
    btn.disabled = false; btn.textContent = original; return;
  }

  document.title = data.allOk ? BASE_TITLE : `⚠ (${data.failCount}) ${BASE_TITLE}`;

  if (data.allOk) {
    out.innerHTML = '<p style="color:#4caf81;font-weight:700;">✓ All good — no schema problems.</p>';
    btn.disabled = false; btn.textContent = original; return;
  }

  // Show ONLY the problems — skip everything that passed.
  const groupsHtml = data.groups.map((g) => {
    const fails = g.checks.filter((c) => !c.ok);
    if (!fails.length) return "";
    const rows = fails.map((c) => `
      <div class="row" style="padding:7px 0;">
        <div class="row-main">
          <span class="row-name" style="color:#e0a030;">✗ ${c.label}</span>
          ${c.detail ? `<span class="row-sub">${c.detail}</span>` : ""}
        </div>
      </div>`).join("");
    return `<p class="sub-label" style="margin-top:16px;">${g.table}</p><div class="list">${rows}</div>`;
  }).join("");

  out.innerHTML = `<p class="warn" style="margin-bottom:10px;">${data.failCount} issue${data.failCount !== 1 ? "s" : ""} to fix in Airtable:</p>` + groupsHtml;
  btn.disabled = false; btn.textContent = original;
};

// ── Card link ──
// The picker offers "Name — email" so a mentee can be found by name, but the
// backend needs the address on its own, so whatever is typed is resolved back
// to a real mentee first. Typing a bare email still works.
let CARD_MENTEES = [];

async function loadCardMentees() {
  const list = document.getElementById("card-mentees");
  if (!list) return;
  if (isLocal) {
    CARD_MENTEES = [{ name: "Mary Chen", email: "mary@mock.com" }];
  } else {
    try {
      const res = await fetch("/.netlify/functions/mentee-financials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminEmail: ADMIN_EMAIL }),
      });
      const data = await res.json();
      if (!res.ok) return;                       // picker is a convenience, not a blocker
      CARD_MENTEES = (data.mentees || []).filter((m) => m.email);
    } catch { return; }
  }
  list.innerHTML = CARD_MENTEES
    .map((m) => `<option value="${m.name} — ${m.email}"></option>`).join("");
}

// Accepts "Name — email", a bare email, or a name typed without picking from
// the list. Returns "" when the text matches nobody and is not an email.
function resolveCardEmail(text) {
  const q = text.trim();
  if (!q) return "";
  const dashed = q.split("—").pop().trim();      // picked straight from the list
  if (dashed.includes("@")) return dashed;
  const lower = q.toLowerCase();
  const hit = CARD_MENTEES.find((m) => m.name.toLowerCase() === lower)
    || CARD_MENTEES.find((m) => m.name.toLowerCase().includes(lower));
  return hit ? hit.email : (q.includes("@") ? q : "");
}

window.makeCardLink = async function (btn) {
  const typed = document.getElementById("card-email").value;
  const email = resolveCardEmail(typed);
  const out = document.getElementById("card-out");
  if (!email) {
    out.innerHTML = typed.trim()
      ? '<span style="color:#e0a030;">No mentee matches that. Pick one from the list, or type their email.</span>'
      : '<span style="color:#e0a030;">Pick a mentee first.</span>';
    return;
  }
  const original = btn.textContent; btn.disabled = true; btn.textContent = "Generating…";
  out.textContent = "";

  if (isLocal) {
    const url = "https://checkout.stripe.com/c/pay/cs_test_MOCK_link_example";
    out.innerHTML = cardLinkHtml("Mary Chen", url);
    btn.disabled = false; btn.textContent = original; return;
  }
  try {
    const res = await fetch("/.netlify/functions/create-card-link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: ADMIN_EMAIL, email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not generate link");
    out.innerHTML = cardLinkHtml(data.mentee, data.url);
  } catch (e) {
    out.innerHTML = `<span style="color:#e05050;">${e.message}</span>`;
  }
  btn.disabled = false; btn.textContent = original;
};

function cardLinkHtml(mentee, url) {
  return `
    <p style="margin-bottom:8px;">Card link for <strong>${mentee}</strong> (valid ~24h). Send it to them:</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input readonly value="${url}" onclick="this.select()" style="flex:1;min-width:200px;background:rgba(255,255,255,0.05);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 11px;font-size:0.8rem;font-family:inherit;" />
      <button class="btn" onclick="navigator.clipboard.writeText('${url}').then(()=>{this.textContent='Copied ✓'})">Copy</button>
    </div>`;
}

// ── Package tracker ──
window.loadPackages = async function (btn) {
  const out = document.getElementById("package-out");
  btn.disabled = true; const original = btn.textContent; btn.textContent = "Loading…";

  let data;
  if (isLocal) {
    data = { count: 3, mentees: [
      { name: "Chen Wei",   mentor: "aidanmwibrata@gmail.com", used: 5, prior: 0, logged: 5, total: 5, remaining: 0, status: "exhausted" },
      { name: "Sofia Rossi",mentor: "raunaqrsa@gmail.com",     used: 4, prior: 3, logged: 1, total: 5, remaining: 1, status: "low" },
      { name: "Omar Haddad",mentor: "raunaqrsa@gmail.com",     used: 2, prior: 0, logged: 2, total: 5, remaining: 3, status: "ok" },
    ] };
  } else {
    try {
      const res = await fetch("/.netlify/functions/package-tracker", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminEmail: ADMIN_EMAIL }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e) {
      out.innerHTML = `<span style="color:#e05050;">${e.message}</span>`;
      btn.disabled = false; btn.textContent = original; return;
    }
  }

  if (!data.mentees || data.mentees.length === 0) {
    out.innerHTML = '<p class="empty">No package mentees found.</p>';
    btn.disabled = false; btn.textContent = original; return;
  }

  const badge = (m) => {
    if (m.status === "exhausted") return '<span class="warn">EXHAUSTED</span>';
    if (m.status === "low")       return '<span class="warn">1 left</span>';
    return `<span style="color:#4caf81;">${m.remaining} left</span>`;
  };

  out.innerHTML = `<div class="list">${data.mentees.map((m) => {
    const breakdown = (m.prior > 0)
      ? `${m.mentor || "—"} · ${m.prior} prior + ${m.logged} logged`
      : (m.mentor || "—");
    return `
    <div class="row">
      <div class="row-main">
        <span class="row-name">${m.name}</span>
        <span class="row-sub">${breakdown}</span>
      </div>
      <span class="row-amount">${m.used}${m.total != null ? " / " + m.total : ""} &nbsp; ${badge(m)}</span>
    </div>`;
  }).join("")}</div>`;
  btn.disabled = false; btn.textContent = original;
};

// ── Mentee audit ──
window.runAudit = async function (btn) {
  const out = document.getElementById("audit-out");
  btn.disabled = true; const original = btn.textContent; btn.textContent = "Scanning…";

  let data;
  if (isLocal) {
    data = {
      mentorCount: 2, menteeCount: 6,
      summary: [
        { email: "raunaqrsa@gmail.com", name: "Raunaq", menteeCount: 1, mentees: ["Mary Chen"] },
        { email: "aidanmwibrata@gmail.com", name: "Aidan", menteeCount: 2, mentees: ["Priya Sharma", "Chen Wei"] },
      ],
      issues: [
        { mentee: "James Liu",  mentorEmailPlain: "",                    problems: ["blank"] },
        { mentee: "Yuki Tanaka",mentorEmailPlain: "Raunaqrsa@gmail.com", problems: ["unknown"] },
        { mentee: "Sara Kim",   mentorEmailPlain: "raunaqrsa@gmail.com ",problems: ["unknown","nocard"] },
      ],
    };
  } else {
    try {
      const res = await fetch("/.netlify/functions/audit-mentees", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminEmail: ADMIN_EMAIL, allowlist: ALLOWED_MENTOR_EMAILS }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e) {
      out.innerHTML = `<span style="color:#e05050;">${e.message}</span>`;
      btn.disabled = false; btn.textContent = original; return;
    }
  }

  const labels = { blank: "No mentor set", unknown: "Mentor email doesn't match any mentor", nocard: "No card on file" };
  const summaryHtml = data.summary.map((m) => `
    <div class="row">
      <div class="row-main">
        <span class="row-name">${m.name}</span>
        <span class="row-sub">${m.email}</span>
      </div>
      <span class="row-amount ${m.menteeCount === 0 ? "warn" : ""}">${m.menteeCount} mentee${m.menteeCount !== 1 ? "s" : ""}</span>
    </div>`).join("");

  const issuesHtml = data.issues.length ? data.issues.map((i) => `
    <div class="row">
      <div class="row-main">
        <span class="row-name">${i.mentee}</span>
        <span class="row-sub">${i.mentorEmailPlain ? `set to: "${i.mentorEmailPlain}"` : "no mentor email"}</span>
      </div>
      <span class="row-amount warn">${i.problems.map(p => labels[p] || p).join(" · ")}</span>
    </div>`).join("") : '<p class="empty">No issues found — every mentee is linked and chargeable.</p>';

  out.innerHTML = `
    <p class="sub-label">Mentees per mentor</p>
    <div class="list">${summaryHtml}</div>
    <p class="sub-label" style="margin-top:24px;">Problems to fix (${data.issues.length})</p>
    <div class="list">${issuesHtml}</div>`;
  btn.disabled = false; btn.textContent = original;
};
