import { normalizeToE164 } from "./normalize.js";
import { listPeople, getBoxesForPerson, boxUrl, personUrl } from "./streak.js";
import type { LookupResponse, MatchResult, StreakPerson } from "./types.js";

function digitsOnly(s: string) {
  return s.replace(/\D+/g, "");
}

function Phones(p: StreakPerson): string[] {
  const raw = ([] as string[]).concat(
    (p.phone ?? []) as any,
    (p.phones ?? []) as any
  );
  return raw.filter(Boolean).map(String);
}

export async function lookupByPhoneNumber(input: string): Promise<LookupResponse> {
  const norm = normalizeToE164(input);
  if (!norm) return { query: input, normalized: null, matches: [] };

  const want10 = digitsOnly(norm).slice(-10);
  const people = await listPeople();

  const out: MatchResult[] = [];

  for (const person of people) {
    const phones = Phones(person).map(digitsOnly);
    const hit = phones.some(ph => ph.endsWith(want10)); // tolerate +1 prefix
    if (!hit) continue;

    const boxes = await getBoxesForPerson(person.key).catch(() => []);

    if (boxes.length === 0) {
      out.push({
        score: 1, 
        contact: person,
        links: { openPerson: personUrl(person) }
      });
    } else {
      for (const b of boxes) {
        out.push({
          score: 1,
          contact: person,
          box: b,
          links: { openBox: boxUrl(b), openPerson: personUrl(person) }
        });
      }
    }
    if (out.length >= 5) break;
  }

  return { query: input, normalized: norm, matches: out.slice(0, 5) };
}
