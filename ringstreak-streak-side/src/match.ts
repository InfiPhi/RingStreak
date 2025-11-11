import { normalizeToE164, variants as e164Variants } from "./normalize.js";
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

const onlyDigits = (s: string) => String(s || "").replace(/\D+/g, "");
function buildPhoneQueries(e164: string) {
  const d = onlyDigits(e164);
  const last10 = d.slice(-10);
  const set = new Set<string>();

  for (const v of e164Variants(e164)) {
    set.add(v);                     
    set.add(onlyDigits(v));            
  }

  // Common extras
  if (last10 && last10.length === 10) {
    set.add(last10);                  
    set.add("+1" + last10);       
  }
  if (d) {
    set.add(d);
    set.add("+" + d);
  }
  set.delete("");
  return Array.from(set);
}

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

  const wantDigits = onlyDigits(norm);
  const want10 = wantDigits.slice(-10);
  const phoneQueries = buildPhoneQueries(norm);
  const contactMap = new Map<string, any>();
  const allBoxRows: any[] = [];

  async function fetchSearches(queries: string[]) {
    const tasks = queries.map(async (q) => {
      const raw = await searchAll(q).catch(() => null);
      return { query: q, raw };
    });
    return Promise.all(tasks);
  }

  const phoneResults = await fetchSearches(phoneQueries);
  for (const { raw } of phoneResults) {
    const { contacts, boxes } = splitSearchResults(raw || {});
    for (const c of contacts) {
      const key =
        c?.key || c?.contactKey || c?.id || c?.personKey || c?.contact_id || "";
      if (key && !contactMap.has(key)) contactMap.set(key, c);
    }
    for (const b of boxes || []) allBoxRows.push(b);
  }

  const contactRows = Array.from(contactMap.values());
  const matchedPeople: StreakPerson[] = [];
  for (const row of contactRows) {
    const p = mapSearchContactToPerson(row);
    const phonesList: string[] = [
      ...(Array.isArray(p.phone) ? p.phone : p.phone ? [p.phone] : []),
      ...(Array.isArray(p.phones) ? p.phones : []),
    ].filter((x): x is string => typeof x === "string");

    const phoneDigits = phonesList.map(onlyDigits);
    const hit = phoneDigits.some((d) => d === wantDigits || d.endsWith(want10));
    if (hit) matchedPeople.push(p);
  }
  const primaryPerson = matchedPeople[0] || null;
  let orgNameFromContacts =
    contactRows.map(contactOrg).find(Boolean) as string | undefined;

  let enrichedPerson: StreakPerson | null = primaryPerson;
  if (primaryPerson?.key) {
    const full = await getContactFull(primaryPerson.key).catch(() => null);
    if (full) {
      enrichedPerson = { ...primaryPerson, ...full };
      if (!orgNameFromContacts && full.organization)
        orgNameFromContacts = full.organization;
    }
  }

  const boxMap = new Map<string, StreakBox>();

  if (matchedPeople.length) {
    for (const p of matchedPeople) {
      const bx = await getBoxesForContact(p.key).catch(() => []);
      for (const b of bx) if (b?.key) boxMap.set(b.key, b);
    }
  }

  for (const row of allBoxRows) {
    const b = mapSearchBox(row);
    if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
  }

  const nameTokens: string[] = [];
  if (enrichedPerson?.name) {
    const t = String(enrichedPerson.name).split(/\s+/).filter(Boolean);
    nameTokens.push(String(enrichedPerson.name));
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

  const extraQueries = new Set<string>([
    ...(orgNameFromContacts ? [orgNameFromContacts] : []),
    ...nameTokens,
    ...emailTokens,
  ]);

  const extraResults = await fetchSearches(Array.from(extraQueries));
  for (const { raw } of extraResults) {
    const boxes = Array.isArray(raw?.results?.boxes) ? raw.results.boxes : [];
    for (const row of boxes) {
      const b = mapSearchBox(row);
      if (b?.key && !boxMap.has(b.key)) boxMap.set(b.key, b);
    }
  }

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
