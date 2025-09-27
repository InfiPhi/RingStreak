import fetch from "node-fetch";
import { env } from "./env.js";
import type { StreakBox, StreakPerson } from "./types.js";

const AUTH = "Basic " + Buffer.from(env.STREAK_API_KEY + ":").toString("base64");

async function get<T>(path: string): Promise<T> {
  const url = `${env.STREAK_API_BASE}${path}`;
  const r = await fetch(url, { headers: { Authorization: AUTH } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Streak GET ${path} failed: ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json() as Promise<T>;
}

export async function searchAll(query: string): Promise<any> {
  return get<any>(`/search?query=${encodeURIComponent(query)}`);
}

export async function getContact(contactKey: string): Promise<any> {
  return get<any>(`/contacts/${contactKey}`);
}


export async function getBoxesForContact(contactKey: string): Promise<StreakBox[]> {
  try {
    return await get<StreakBox[]>(`/contacts/${contactKey}/boxes`);
  } catch {
    return [];
  }
}


export function boxUrl(b: StreakBox) {
  return `https://www.streak.com/p/${b.key}`;
}
export function contactUrl(contactKey: string) {
  return `https://www.streak.com/contacts/${contactKey}`;
}

export function mapContactToPerson(raw: any): StreakPerson {
  const phones = ([] as string[]).concat(
    ...(Array.isArray(raw?.phoneNumbers) ? [raw.phoneNumbers] : []),
    raw?.phone ? [raw.phone] : [],        
    raw?.phones ? raw.phones : []             
  ).filter(Boolean).map(String);

  return {
    key: raw?.key ?? raw?.contactKey ?? "",
    name: raw?.name,
    email: raw?.email,
    phone: phones.length === 1 ? phones[0] : undefined,
    phones: phones.length > 1 ? phones : undefined,
    organization: raw?.organization,
    fields: raw?.fields ?? {},
  };
}
