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
  const digitsOnly = e164.replace(/\D+/g, "");
  const noPlus = e164.replace(/^\+/, "");
  const local10 =
    digitsOnly.length === 11 && digitsOnly.startsWith("1")
      ? digitsOnly.slice(1)
      : digitsOnly.length === 10
      ? digitsOnly
      : "";

  const all = new Set<string>();
  const grouped = e164.replace(/(\+\d{1,3})(\d{3})(\d{3})(\d{4})/, "$1 $2 $3 $4");

  [e164, noPlus, digitsOnly, grouped, local10, digitsOnly ? `+${digitsOnly}` : ""].forEach((v) => {
    if (v) all.add(v);
  });

  if (local10.length === 10) {
    const area = local10.slice(0, 3);
    const prefix = local10.slice(3, 6);
    const line = local10.slice(6);

    [
      `(${area}) ${prefix}-${line}`,
      `(${area})${prefix}-${line}`,
      `${area}-${prefix}-${line}`,
      `${area} ${prefix} ${line}`,
      `${area}.${prefix}.${line}`,
      `${area}${prefix}${line}`,
      `+1-${area}-${prefix}-${line}`,
      `+1 ${area} ${prefix} ${line}`,
      `+1 ${area}-${prefix}-${line}`,
      `+1 (${area}) ${prefix}-${line}`,
      `+1(${area}) ${prefix}-${line}`,
    ].forEach((v) => all.add(v));
  }

  return Array.from(all);
}
