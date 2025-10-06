import { normalizeToE164 } from "./normalize.js";
import {
  searchAll,
  splitSearchResults,
  mapSearchContactToPerson,
  contactUrl,
  boxUrl,
  getBoxesForSearchRow,
  mapSearchBox,
  contactOrg,
  getStageMap,
  getLastEmailPreview,
} from "./streak.js";
import type { LookupResponse, MatchResult, StreakBox, StreakPerson } from "./types.js";

const digits = (s: string) => s.replace(/\D+/g, "");

async function mkMatch(person: StreakPerson | null, box?: StreakBox): Promise<MatchResult> {
  const links = {
    openPerson: person ? contactUrl(person.key) : undefined,
    openBox: box ? boxUrl(box) : undefined,
  };

  let stageName: string | undefined;
  if (box?.pipelineKey && box.stageKey) {
    const map = await getStageMap(box.pipelineKey).catch(() => ({} as Record<string, string>));
    stageName = map[box.stageKey];
  }

  // Last email preview via Streak (timeline v2 → threads v1 fallback lives inside streak.ts)
  const lastEmail = box ? await getLastEmailPreview(box.key) : null;

  const enrichedBox = box ? { ...box, stageName, lastEmail } : undefined;

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

  // 1) Streak search
  const raw = await searchAll(want).catch(() => null);
  const { contacts: contactRows } = splitSearchResults(raw || {});

  // 2) True phone matches + collect boxes using the *search row* (handles v2 global → v1 numeric)
  const matchedPeople: StreakPerson[] = [];
  const boxMap = new Map<string, StreakBox>();

  for (const row of contactRows) {
    const p = mapSearchContactToPerson(row);
    const phones = [
      ...(p.phone ? [p.phone] : []),
      ...(Array.isArray(p.phones) ? p.phones : []),
      ...(Array.isArray((row as any)?.phoneNumbers) ? (row as any).phoneNumbers.map(String) : []),
    ].filter((x): x is string => typeof x === "string");

    const hit = phones.map(digits).some((d) => d === want || d.endsWith(want10));
    if (hit) {
      matchedPeople.push(p);
      const bx = await getBoxesForSearchRow(row).catch(() => []);
      for (const b of bx) boxMap.set(b.key, b);
    }
  }

  const primaryPerson = matchedPeople[0] || null;
  const orgNameFromContacts = contactRows.map(contactOrg).find(Boolean);

  // 3) Fallbacks to find boxes even if not explicitly linked
  if (boxMap.size === 0 && orgNameFromContacts) {
    const rawCompany = await searchAll(orgNameFromContacts).catch(() => null);
    const boxesCompany = Array.isArray(rawCompany?.results?.boxes) ? rawCompany.results.boxes : [];
    for (const row of boxesCompany) {
      const b = mapSearchBox(row);
      boxMap.set(b.key, b);
    }
  }

  if (boxMap.size === 0) {
    const rawDigits = await searchAll(want).catch(() => null);
    const boxesDigits = Array.isArray(rawDigits?.results?.boxes) ? rawDigits.results.boxes : [];
    for (const row of boxesDigits) {
      const b = mapSearchBox(row);
      boxMap.set(b.key, b);
    }
  }

  if (boxMap.size === 0 && (primaryPerson?.name || "").trim()) {
    const rawName = await searchAll(String(primaryPerson!.name)).catch(() => null);
    const boxesName = Array.isArray(rawName?.results?.boxes) ? rawName.results.boxes : [];
    for (const row of boxesName) {
      const b = mapSearchBox(row);
      boxMap.set(b.key, b);
    }
  }

  // 4) Sort by recency and assemble matches
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
