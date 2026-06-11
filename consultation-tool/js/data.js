// Single source of truth for the consultation tool.
// Personas, the 5-stage session framework, and the mentor roster.

// ── The 5-stage session framework ──
// Each stage lists the individual sessions inside it.
export const stages = {
  1: {
    name: "Knowing where to apply",
    sessionLabel: "2 sessions",
    sessions: [
      "Target role mapping",
      "Hiring landscape overview",
    ],
  },
  2: {
    name: "Strong application material",
    sessionLabel: "3 sessions",
    sessions: [
      "Resume + Cover Letter Fix",
      "LinkedIn Improvement",
      "Finding your USP",
    ],
  },
  3: {
    name: "Building a network",
    sessionLabel: "2 sessions",
    sessions: [
      "Who to reach out",
      "Outreach structure",
    ],
  },
  4: {
    name: "Initial interviews",
    sessionLabel: "2–3 sessions",
    sessions: [
      "Screening Calls",
      "Recorded Interviews",
    ],
  },
  5: {
    name: "Final boss",
    sessionLabel: "3–5 sessions",
    sessions: [
      "F2F Interview Prep",
      "Assessment Centre",
      "Individual Case Study",
    ],
  },
  6: {
    name: "It's only the start",
    sessionLabel: "2 sessions",
    sessions: [
      "Turn Internship into return offer",
      "Turn Internship into another better Grad role",
    ],
  },
};

// ── The 4 personas ──
export const personas = [
  {
    id: "visibility-fix",
    name: "Grad/Junior Role: The Visibility Fix",
    tag: "Applying for grad roles, no callbacks yet",
    desc: "Has started applying for graduate or junior roles but the inbox stays silent. Time to fix the visibility problem.",
    sessions: "12–15 sessions",
    stages: [2, 3, 4, 5],
  },
  {
    id: "seal-the-deal",
    name: "Grad/Junior Role: Seal the Deal",
    tag: "Making finals, can't close the offer",
    desc: "Gets through the early rounds but can't convert when it counts. The offer is one step away.",
    sessions: "5–6 sessions",
    stages: [2, 5],
    sessionOverrides: { 2: { name: "Finding Your Edge", sessionLabel: "2 sessions", sessions: ["Understanding your story", "Present them as unique stories"] } },
  },
  {
    id: "internship-bound",
    name: "Internship Bound: Let's Build the Plan",
    tag: "Wants to start early, no clue where to begin",
    desc: "Knows the market is brutal and wants a head start, but has no clue where to begin or what to target.",
    sessions: "15–16 sessions",
    stages: [1, 2, 3, 4, 5],
  },
  {
    id: "internship-slipping",
    name: "The Internship That Keeps Slipping",
    tag: "Has tried, has traction, still no offer",
    desc: "Knows what roles to chase and has some society or screening experience, but the internship keeps slipping through.",
    sessions: "12 sessions",
    stages: [5, 6],
  },
];

export function getPersona(id) {
  return personas.find((p) => p.id === id) || personas[0];
}
