import { normalizeToE164 } from "./normalize.js";
import {
  searchAll,
  splitSearchResults,
  mapSearchContactToPerson,
  contactUrl,
  boxUrl,
  getBoxesForContact,
  mapSearchBox,
  contactOrg,
  resolveStageForBox,
  getLastEmailPreview,
} from "./streak.js";
import type { LookupResponse, MatchResult, StreakBox, StreakPerson } from "./types.js";

const digits = (s: string) => String(s || "").replace(/\D+/g, "");

async function mkMatch(person: StreakPerson | null, box?: StreakBox): Promise<MatchResult> {
  const links = {
    openPerson: person?.key ? contactUrl(person.key) : undefined,
    openBox: box?.key ? boxUrl(box) : undefined,
  };

  let enrichedBox: StreakBox | undefined = box;
  if (box?.key) {
    const stage = await resolveStageForBox(box).catch(() => ({} as any));
    const lastEmail = await getLastEmailPreview(box.key).catch(() => null);
    enrichedBox = { ...box, stageName: stage?.stageName, lastEmail };
  }

  return {
    score: box ? 2 : 1,
    contact: person ?? ({ key: "unknown" } as StreakPerson),
    box: enrichedBox,
    links,
  };
}

export async function lookupByPhone(input: string): Promise<LookupResponse> {
  const norm = normalizeToE164(input);
  if (!norm) return { query: input, normalized: null, matches: [] };

  const want = digits(norm);
  const want10 = want.slice(-10);

  const raw = await searchAll(want).catch(() => null);
  const { contacts: contactRows } = splitSearchResults(raw || {});

  const matchedPeople: StreakPerson[] = [];
  for (const row of contactRows) {
    const p = mapSearchContactToPerson(row);
    const phonesList: string[] = [
      ...(Array.isArray(p.phone) ? p.phone : p.phone ? [p.phone] : []),
      ...(Array.isArray(p.phones) ? p.phones : []),
    ].filter((x): x is string => typeof x === "string");

    const phoneDigits = phonesList.map(digits);
    const hit = phoneDigits.some((d) => d === want || d.endsWith(want10));
    if (hit) matchedPeople.push(p);
  }

  const primaryPerson = matchedPeople[0] || null;
  const orgNameFromContacts = contactRows.map(contactOrg).find(Boolean) as string | undefined;

  const boxMap = new Map<string, StreakBox>();

  if (matchedPeople.length) {
    for (const p of matchedPeople) {
      const bx = await getBoxesForContact(p.key).catch(() => []);
      for (const b of bx) if (b?.key) boxMap.set(b.key, b);
    }
  }

  if (orgNameFromContacts) {
    const rawCompany = await searchAll(orgNameFromContacts).catch(() => null);
    const boxesCompany = Array.isArray(rawCompany?.results?.boxes) ? rawCompany.results.boxes : [];
    for (const row of boxesCompany) {
      const b = mapSearchBox(row);
      if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
    }
  }

  {
    const rawDigits = await searchAll(want).catch(() => null);
    const boxesDigits = Array.isArray(rawDigits?.results?.boxes) ? rawDigits.results.boxes : [];
    for (const row of boxesDigits) {
      const b = mapSearchBox(row);
      if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
    }
  }

  if ((primaryPerson?.name || "").trim()) {
    const rawName = await searchAll(String(primaryPerson!.name)).catch(() => null);
    const boxesName = Array.isArray(rawName?.results?.boxes) ? rawName.results.boxes : [];
    for (const row of boxesName) {
      const b = mapSearchBox(row);
      if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
    }
  }

  const boxes = Array.from(boxMap.values()).sort(
    (a, b) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0)
  );

  const matches: MatchResult[] = [];
  if (boxes.length > 0) {
    matches.push(await mkMatch(primaryPerson, boxes[0]));
    for (const b of boxes.slice(1)) {
      matches.push(await mkMatch(primaryPerson, b));
      if (matches.length >= 12) break;
    }
  } else if (primaryPerson) {
    matches.push(await mkMatch(primaryPerson));
  }

  return { query: input.replace(/^\+?/, " "), normalized: norm, matches };
}
