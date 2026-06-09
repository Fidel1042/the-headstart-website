// Single source of truth for the consultation tool.
// Personas, the 5-stage session framework, and the mentor roster.

// ── The 5-stage session framework ──
// Each stage lists the individual sessions inside it.
export const stages = {
  1: {
    name: "Knowing where to apply",
    sessionLabel: "2 sessions",
    sessions: [
      "Map your target roles and a realistic company list",
      "Understand the hiring landscape, timelines and entry points",
    ],
  },
  2: {
    name: "Strong application material",
    sessionLabel: "3 sessions",
    sessions: [
      "Find your unique selling points (what makes you memorable)",
      "Rebuild your resume and cover letter around those USPs",
      "Overhaul your LinkedIn profile",
    ],
  },
  3: {
    name: "Building a network",
    sessionLabel: "3 sessions",
    sessions: [
      "Networking strategy: who to reach, and when",
      "Outreach messages and coffee-chat scripts",
      "Turning conversations into referrals",
    ],
  },
  4: {
    name: "Initial interviews",
    sessionLabel: "2 sessions",
    sessions: [
      "Nail \"tell me about yourself\" and the behavioural basics",
      "Mock interview with recorded feedback",
    ],
  },
  5: {
    name: "Final boss",
    sessionLabel: "3-5 sessions",
    sessions: [
      "Assessment centre and group exercise prep",
      "Case studies and technical rounds",
      "Final-round presentation and closing impression",
      "Extra mock rounds, depending on how fast you improve",
    ],
  },
};

// ── The 4 personas ──
export const personas = [
  {
    id: "keen-but-lost",
    name: "Keen but Lost",
    tag: "Wants to start early, no idea where",
    desc: "Knows the market is brutal and wants a head start, but has no clue where to begin or what to target.",
    sessions: "15-16 sessions",
    stages: [1, 2, 3, 4, 5],
  },
  {
    id: "grinding-no-win-yet",
    name: "Grinding, No Win Yet",
    tag: "Trying hard, no internship yet",
    desc: "Knows what roles to chase and has some society or screening experience, but hasn't landed an internship yet.",
    sessions: "12 sessions",
    stages: [2, 3, 4, 5],
  },
  {
    id: "applying-into-the-void",
    name: "Applying Into the Void",
    tag: "Applying for grad roles, silence back",
    desc: "Has started applying for graduate roles but the inbox stays silent. Nothing to show for all the effort.",
    sessions: "12-15 sessions",
    stages: [2, 3, 4, 5],
  },
  {
    id: "so-close-cant-close",
    name: "So Close, Can't Close",
    tag: "Reaches finals, can't seal it",
    desc: "Gets through the early rounds but can't seal the deal when it counts at the final stage.",
    sessions: "5-6 sessions",
    stages: [2, 5],
  },
];

export function getPersona(id) {
  return personas.find((p) => p.id === id) || personas[0];
}
