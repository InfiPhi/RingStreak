import { normalizeToE164 } from "./normalize.js";
import {
  searchAll,
  getBoxesForContact,
  boxUrl,
  contactUrl,
  mapContactToPerson,
} from "./streak.js";
import type { LookupResponse, MatchResult, StreakBox, StreakPerson } from "./types.js";

function digitsOnly(s: string) {
  return s.replace(/\D+/g, "");
}

function makeMatch(person: StreakPerson, box?: StreakBox): MatchResult {
  return {
    score: box ? 2 : 1, // change
    contact: person,
    box,
    links: {
      openPerson: contactUrl(person.key),
      openBox: box ? boxUrl(box) : undefined,
    },
  };
}

export async function lookupByPhone(input: string): Promise<LookupResponse> {
  const norm = normalizeToE164(input);
  if (!norm) return { query: input, normalized: null, matches: [] };

  const wantDigits = digitsOnly(norm);
  const wantLast10 = wantDigits.slice(-10);

  const search = await searchAll(wantDigits).catch(() => null);
  const items: any[] = Array.isArray(search?.results)
    ? search.results
    : Array.isArray(search)
    ? search
    : [];

  const contactRows = items.filter((r: any) => {
    const t = String(r?.type || r?.resultType || "").toUpperCase();
    return t.includes("CONTACT");
  });

  const people: StreakPerson[] = [];
  for (const row of contactRows) {
    const key = row?.key || row?.contactKey;
    if (!key) continue;
    const person = mapContactToPerson(row);
    const phones: string[] = [
      ...(person.phone ? [person.phone] : []),
      ...(person.phones ?? [])
    ].flat();
    const hit = phones
      .map(digitsOnly)
      .some((p) => p.endsWith(wantLast10) || p === wantDigits);
    if (hit) people.push(person);
  }

  const matches: MatchResult[] = [];
  for (const p of people) {
    let pushed = false;
    matches.push(makeMatch(p));
    pushed = true;

    const boxes = await getBoxesForContact(p.key).catch(() => []);
    for (const b of boxes) {
      matches.push(makeMatch(p, b));
      if (matches.length >= 8) break;
    }
    if (pushed && matches.length >= 8) break;
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const an = a.contact.name?.toLowerCase() || "";
    const bn = b.contact.name?.toLowerCase() || "";
    return an.localeCompare(bn);
  });

  return { query: input, normalized: norm, matches };
}
