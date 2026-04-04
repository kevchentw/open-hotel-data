export function normalizeText(value) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}
