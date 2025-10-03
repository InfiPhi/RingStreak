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
  getStageMap,
} from "./streak.js";
import type { LookupResponse, MatchResult, StreakBox, StreakPerson } from "./types.js";

/** Keep just digits for comparisons. */
const digits = (s: string) => s.replace(/\D+/g, "");

/** Try to fetch a short "last email" snippet for a box (stub for now). */
async function getLastEmailSnippetForBox(_box: StreakBox): Promise<string | null> {
  // Hook point: integrate Gmail API here when tokens are wired.
  // For now, return null so UI can hide it if missing.
  return null;
}

/** Build a match row with optional stageName + email snippet. */
async function mkMatch(person: StreakPerson | null, box?: StreakBox): Promise<MatchResult> {
  const links = { openPerson: person ? contactUrl(person.key) : undefined, openBox: box ? boxUrl(box) : undefined };

  // Stage name lookup (best-effort)
  let stageName: string | undefined;
  if (box?.pipelineKey && box.stageKey) {
    const map = await getStageMap(box.pipelineKey).catch(() => ({} as Record<string, string>));
    stageName = map[box.stageKey];
  }

  // Last email snippet (optional)
  const lastEmail = box ? await getLastEmailSnippetForBox(box) : null;

  // Attach stageName/lastEmail into the box object so the UI gets it
  const enrichedBox = box ? { ...box, stageName, lastEmail } : undefined;

  return {
    score: box ? 2 : 1,
    contact: person ?? ({ key: "unknown" } as StreakPerson),
    box: enrichedBox,
    links,
  };
}

/**
 * Final lookup flow:
 * 1) Normalize phone → digits/last10.
 * 2) Search by digits; map contacts that truly match phone.
 * 3) Gather boxes: first via contact→boxes; if sparse, do company name search for boxes.
 * 4) Sort by recency; pick most recent as "primary".
 * 5) Return primary + others.
 */
export async function lookupByPhone(input: string): Promise<LookupResponse> {
  const norm = normalizeToE164(input);
  if (!norm) return { query: input, normalized: null, matches: [] };

  const want = digits(norm);
  const want10 = want.slice(-10);

  // 1) Search Streak
  const raw = await searchAll(want).catch(() => null);
  const { contacts: contactRows } = splitSearchResults(raw || {});

  // 2) Map contacts and confirm phone hit (full or last10 match)
  const matchedPeople: StreakPerson[] = [];
  for (const row of contactRows) {
    const p = mapSearchContactToPerson(row);
    const phones = [
      ...(p.phone ? [p.phone] : []),
      ...(Array.isArray(p.phones) ? p.phones : [])
    ];
    const hit = phones.filter((ph): ph is string => typeof ph === "string").map(digits).some((d) => d === want || d.endsWith(want10));
    if (hit) matchedPeople.push(p);
  }

  // If no people hit, we still try a company fallback via any org from contacts list.
  const primaryPerson = matchedPeople[0] || null;
  const orgNameFromContacts = contactRows.map(contactOrg).find(Boolean);

  // 3) Collect candidate boxes:
  //    a) boxes linked to matched contacts
  const boxMap = new Map<string, StreakBox>();
  for (const p of matchedPeople) {
    const bx = await getBoxesForContact(p.key).catch(() => []);
    for (const b of bx) boxMap.set(b.key, b);
  }

  //    b) if we still have no boxes or want to broaden, search boxes by company name
  if (boxMap.size === 0 && orgNameFromContacts) {
    const rawCompany = await searchAll(orgNameFromContacts).catch(() => null);
    const boxesArr = Array.isArray(rawCompany?.results?.boxes) ? rawCompany.results.boxes : [];
    for (const row of boxesArr) {
      const b = mapSearchBox(row);
      boxMap.set(b.key, b);
    }
  }

  // 4) Sort boxes by last update desc. build matches: primary first, then others
  const boxes = Array.from(boxMap.values()).sort(
    (a, b) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0)
  );

  const matches: MatchResult[] = [];
  if (boxes.length > 0) {
    // Primary: most recent box + primary person (or null)
    matches.push(await mkMatch(primaryPerson, boxes[0]));

    // Others: remaining boxes, keep same person 
    for (const b of boxes.slice(1)) {
      matches.push(await mkMatch(primaryPerson, b));
      if (matches.length >= 12) break;
    }
  } else if (primaryPerson) {
    // No boxes at all — still return the person so the UI has something
    matches.push(await mkMatch(primaryPerson));
  }

  // If still nothing, return an empty response
  return { query: input.replace(/^\+?/, " "), normalized: norm, matches };
}
