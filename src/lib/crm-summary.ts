import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────────
// CRM comms summariser
//
// Turns a lead's raw comms_log (one verbatim row per message — Telegram threads,
// notes, emails) into ONE concise running summary: what happened and where it
// stands, in a line or two. This is what the Renters v3 + CRM/Inbound timelines
// show at the top so the log stays scannable instead of a long per-message dump.
// Matches the team rule "one summarised entry per touchpoint" (see memory).
//
// Model: Claude Haiku 5.5 — cheapest/fastest, right for high-volume short-text
// summarisation. Swap MODEL to claude-opus-5-5 if you want higher-quality summaries.
// Requires ANTHROPIC_API_KEY in the server env.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "claude-haiku-5-5";
const MAX_INPUT_CHARS = 12000; // cap very chatty threads; newest messages kept

export type CommEntry = { ts?: string; channel?: string; body?: string; direction?: string; authorName?: string };

export function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function summariseComms(input: {
  name?: string | null;
  company?: string | null;
  type?: string | null;
  entries: CommEntry[];
}): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const entries = (input.entries || []).filter((e) => (e.body || "").trim());
  if (entries.length === 0) return "";

  // Oldest → newest for a readable narrative; cap total size, keeping the newest.
  const ordered = [...entries].sort((a, b) => ((a.ts || "") > (b.ts || "") ? 1 : -1));
  const lines: string[] = [];
  let total = 0;
  let dropped = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const e = ordered[i];
    const when = e.ts ? new Date(e.ts).toISOString().slice(0, 10) : "";
    const dir = e.direction === "outbound" ? "we" : e.direction === "inbound" ? "them" : "";
    const line = `[${when}${e.channel ? ` ${e.channel}` : ""}${dir ? ` · ${dir}` : ""}] ${(e.body || "").trim()}`;
    if (total + line.length > MAX_INPUT_CHARS) { dropped = i + 1; break; }
    lines.unshift(line);
    total += line.length;
  }
  const transcript = (dropped ? `[${dropped} older message(s) omitted]\n` : "") + lines.join("\n");

  const who = [input.name, input.company ? `(${input.company})` : null, input.type ? `— ${input.type}` : null]
    .filter(Boolean).join(" ");

  const system =
    "You summarise a CRM contact's message history for a LinkedIn-account rental business. " +
    "Write ONE tight summary of the whole relationship so far: what they want, what we've done, " +
    "and where it stands or the next step. 1–2 sentences, max ~45 words. Plain past/present tense, " +
    "no preamble, no bullet points, no greeting. Example style: " +
    "\"Inbound wants to rent 2–3 aged US profiles; sent catalogue + rates, awaiting their pick.\" " +
    "If there's a clear pending action or blocker, end with it. Do not invent facts.";

  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system,
    messages: [{ role: "user", content: `Contact: ${who || "unknown"}\n\nMessages (oldest first):\n${transcript}` }],
  });

  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").trim();
  return text;
}
