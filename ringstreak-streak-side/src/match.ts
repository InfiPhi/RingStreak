import { normalizeToE164 } from "./normalize.js";
import {
  searchAll,
  getBoxesForContact,
  boxUrl,
  contactUrl,
  mapSearchContactToPerson,
} from "./streak.js";
import type { LookupResponse, MatchResult, StreakBox, StreakPerson } from "./types.js";


const digits = (s: string) => s.replace(/\D+/g, "");

function mk(person: StreakPerson, box?: StreakBox): MatchResult {
  return {
    score: box ? 2 : 1,
    contact: person,
    box,
    links: { openPerson: contactUrl(person.key), openBox: box ? boxUrl(box) : undefined },
  };
}

/**
 * Uses Streak search -> results.contacts.
 * - normalize phone
 * - query by digits
 * - filter contacts where any phone matches full digits OR last10
 * - attach boxes per contact
 */
export async function lookupByPhone(input: string): Promise<LookupResponse> {
  const norm = normalizeToE164(input);
  if (!norm) return { query: input, normalized: null, matches: [] };

  const want = digits(norm);
  const want10 = want.slice(-10);

 
  const search = await searchAll(want).catch(() => null);
  const contactsArr: any[] = Array.isArray(search?.results?.contacts)
    ? search.results.contacts
    : [];

  const people: StreakPerson[] = [];
  for (const row of contactsArr) {
    const person = mapSearchContactToPerson(row);
    const phs = [
      ...(person.phone ? [person.phone] : []),
      ...(Array.isArray(person.phones) ? person.phones : [])
    ].filter((p): p is string => typeof p === "string");
    const hit = phs.map(digits).some((p) => p === want || p.endsWith(want10));
    if (hit) people.push(person);
  }

  const matches: MatchResult[] = [];
  for (const p of people) {
    matches.push(mk(p));

    const boxes = await getBoxesForContact(p.key).catch(() => []);
    for (const b of boxes) {
      matches.push(mk(p, b));
      if (matches.length >= 12) break;
    }
    if (matches.length >= 12) break;
  }
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.contact.name || "").localeCompare(b.contact.name || "");
  });

  return { query: input.replace(/^\+?/, " "), normalized: norm, matches };
}
