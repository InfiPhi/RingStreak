import fetch from "node-fetch";
import { env } from "./env.js";

export async function fetchLookup(from: string, to: string, direction: string, callId?: string) {
  const url = `${env.STREAK_SIDE_URL}/ingest/call`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ringstreak-secret": env.STREAK_SHARED_SECRET
    },
    body: JSON.stringify({ from, to, direction, callId, timestamp: Date.now() })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Streak ingest failed: ${r.status} ${t}`);
  }
  return r.json();
}
