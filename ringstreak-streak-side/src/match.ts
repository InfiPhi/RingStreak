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
  getContactFull,
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

  // 1) Search Streak by digits to get candidate contacts
  const raw = await searchAll(want).catch(() => null);
  const { contacts: contactRows } = splitSearchResults(raw || {});

  // 2) Find contacts whose phones match the number
  const matchedPeople: StreakPerson[] = [];
  for (const row of contactRows) {
    const p = mapSearchContactToPerson(row);
    const phonesList: string[] = [
      ...(Array.isArray(p.phone) ? p.phone : p.phone ? [p.phone] : []),
      ...(Array.isArray(p.phones) ? p.phones : []),
    ].filter((x): x is string => typeof x === "string");

    const phoneDigits = phonesList.map(d => digits(d));
    const hit = phoneDigits.some((d) => d === want || d.endsWith(want10));
    if (hit) matchedPeople.push(p);
  }

  // Enrich primary person to unlock org/email tokens
  const primaryPerson = matchedPeople[0] || null;
  let orgNameFromContacts = contactRows.map(contactOrg).find(Boolean) as string | undefined;

  let enrichedPerson: StreakPerson | null = primaryPerson;
  if (primaryPerson?.key) {
    const full = await getContactFull(primaryPerson.key).catch(() => null);
    if (full) {
      enrichedPerson = { ...primaryPerson, ...full };
      if (!orgNameFromContacts && full.organization) orgNameFromContacts = full.organization;
    }
  }

  // 3) Candidate boxes (merge from multiple sources)
  const boxMap = new Map<string, StreakBox>();

  // a) boxes linked to matched contacts
  if (matchedPeople.length) {
    for (const p of matchedPeople) {
      const bx = await getBoxesForContact(p.key).catch(() => []);
      for (const b of bx) if (b?.key) boxMap.set(b.key, b);
    }
  }

  // Build additional search tokens
  const nameTokens: string[] = [];
  if (enrichedPerson?.name) {
    const t = String(enrichedPerson.name).split(/\s+/).filter(Boolean);
    // Prefer full name first
    nameTokens.push(String(enrichedPerson.name));
    // Then individual tokens
    for (const part of t) if (part.length >= 2) nameTokens.push(part);
  }

  const emailTokens: string[] = [];
  const email = enrichedPerson?.email;
  if (email) {
    emailTokens.push(email);
    const at = email.indexOf("@");
    if (at > 0) {
      const domain = email.slice(at + 1);
      if (domain) emailTokens.push(domain);
    }
  }

  const phoneVariants = new Set<string>([want]);
  if (want10 && want10.length === 10) phoneVariants.add(want10);

  const orgTokens = new Set<string>();
  if (orgNameFromContacts) orgTokens.add(orgNameFromContacts);

  // b) by company/organization
  for (const q of orgTokens) {
    const rawCompany = await searchAll(q).catch(() => null);
    const boxesCompany = Array.isArray(rawCompany?.results?.boxes) ? rawCompany.results.boxes : [];
    for (const row of boxesCompany) {
      const b = mapSearchBox(row);
      if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
    }
  }

  // c) by phone digits and last-10
  for (const q of phoneVariants) {
    const rawDigits = await searchAll(q).catch(() => null);
    const boxesDigits = Array.isArray(rawDigits?.results?.boxes) ? rawDigits.results.boxes : [];
    for (const row of boxesDigits) {
      const b = mapSearchBox(row);
      if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
    }
  }

  // d) by contact name (full + parts)
  for (const q of nameTokens) {
    const rawName = await searchAll(q).catch(() => null);
    const boxesName = Array.isArray(rawName?.results?.boxes) ? rawName.results.boxes : [];
    for (const row of boxesName) {
      const b = mapSearchBox(row);
      if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
    }
  }

  // e) by email (address + domain)
  for (const q of emailTokens) {
    const rawEmail = await searchAll(q).catch(() => null);
    const boxesEmail = Array.isArray(rawEmail?.results?.boxes) ? rawEmail.results.boxes : [];
    for (const row of boxesEmail) {
      const b = mapSearchBox(row);
      if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
    }
  }

  // 4) Sort by recency and assemble matches
  const boxes = Array.from(boxMap.values()).sort(
    (a, b) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0)
  );

  const matches: MatchResult[] = [];
  if (boxes.length > 0) {
    matches.push(await mkMatch(enrichedPerson ?? primaryPerson, boxes[0]));
    for (const b of boxes.slice(1)) {
      matches.push(await mkMatch(enrichedPerson ?? primaryPerson, b));
      if (matches.length >= 12) break;
    }
  } else if (enrichedPerson ?? primaryPerson) {
    matches.push(await mkMatch(enrichedPerson ?? primaryPerson));
  }

  return { query: input.replace(/^\+?/, " "), normalized: norm, matches };
}
