// Turns the LV team's onboarding backlog (count of form signups still waiting for us to onboard
// them) into an honest, soft-banded wait estimate. It's deliberately vague ("about a week" rather
// than "6.2 days") so it ages well and under-promises. Anchored to the team's real clear-rate:
// ~145 deep reads as "about a week". `wait` is a bare duration — callers add the preposition that
// fits ("about {wait} to onboard", "in about {wait}", "within {wait}") so the grammar stays clean.
//
// Used to push referrers toward doing the email/2FA themselves (the guided flow) instead of the
// passive form, where we do all the setup and they wait at the back of this queue.
export type OnboardingEta = {
  queue: number; // raw backlog, floored at 0
  queueText: string; // "145", or "100+" once it's three digits
  wait: string; // bare duration: "a day" | "2–3 days" | "4–5 days" | "a week"
  busy: boolean; // deeper than usual — worth flagging "busier than usual"
};

export function onboardingEta(queueCount: number | null | undefined): OnboardingEta {
  const queue = Math.max(0, Math.floor(queueCount || 0));
  const wait =
    queue <= 10 ? "a day"
    : queue <= 40 ? "2–3 days"
    : queue <= 90 ? "4–5 days"
    : "a week";
  return { queue, queueText: queue >= 100 ? "100+" : String(queue), wait, busy: queue >= 91 };
}
