// used to convert any variation of a phone number to E.164 format
// and to generate common variants of an E.164 number
// E.164 is the international phone number standard, e.g. +12345678900

export function normalizeToE164(raw?: string | null) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;          // default for canadian numbers
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}

export function variants(e164: string) {
  const noPlus = e164.replace(/^\+/, "");
  const local10 = e164.startsWith("+1") ? e164.slice(2) : e164;   // default for canadian numbers
  const spaced = e164.replace(/(\+\d{1,3})(\d{3})(\d{3})(\d{4})/, "$1 $2 $3 $4");
  return Array.from(new Set([e164, noPlus, local10, spaced]));
}