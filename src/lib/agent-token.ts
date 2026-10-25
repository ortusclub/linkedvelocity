import { createHash, randomBytes } from "node:crypto";

export const AGENT_TOKEN_PREFIX = "agent:";
export function createAgentToken() { return `lvk_${randomBytes(32).toString("hex")}`; }
export function isAgentToken(token: string) { return /^lvk_[a-f0-9]{64}$/.test(token); }
export function agentTokenHash(token: string) {
  return AGENT_TOKEN_PREFIX + createHash("sha256").update(token).digest("hex");
}
