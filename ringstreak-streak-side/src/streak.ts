import fetch from "node-fetch";
import { env } from "./env.js";
import type { StreakBox, StreakPerson } from "./types.js";

// StreakCRM auth = API key as username, no password.
const auth = "Basic " + Buffer.from(env.STREAK_API_KEY + ":").toString("base64");

/* GET wrapper for StreakCRM API.
 * Handles auth + basic error reporting.
 */
async function get<T>(path: string): Promise<T> {
  const url = `${env.STREAK_API_BASE}${path}`;
  const r = await fetch(url, { headers: { Authorization: auth } });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Streak GET ${path} failed: ${r.status} ${text}`);
  }

    //return r.json().then((j) => j as T);
    return r.json() as Promise<T>;
}

/* Grabs all people and filter locally.
 * Might swap to /people/search later if available.
 */
export async function listPeople(): Promise<StreakPerson[]> {
  return get<StreakPerson[]>("/people");
}

/** Fetches all Boxes for a given Person. */
export async function getBoxesForPerson(personKey: string): Promise<StreakBox[]> {
  try {
    return await get<StreakBox[]>(`/people/${personKey}/boxes`);
  } catch {
    return [];
  }
}

/** Central place for Box URLs. */
export function boxUrl(b: StreakBox) {
  return `https://www.streak.com/p/${b.key}`;
}

/** Central place for Person URLs. */
export function personUrl(p: StreakPerson) {
  return `https://www.streak.com/people/${p.key}`;
}
