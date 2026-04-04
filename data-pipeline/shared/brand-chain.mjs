function normalizeString(value) {
  return String(value ?? "").trim();
}

const BRAND_TO_CHAIN = new Map([
  ["andaz", "Hyatt"],
  ["alila", "Hyatt"],
  ["destination hotels", "Hyatt"],
  ["grand hyatt", "Hyatt"],
  ["hyatt centric", "Hyatt"],
  ["hyatt regency", "Hyatt"],
  ["miraval", "Hyatt"],
  ["park hyatt", "Hyatt"],
  ["the unbound collection", "Hyatt"],
  ["thompson hotels", "Hyatt"],
  ["curio collection", "Hilton"],
  ["conrad hotels & resorts", "Hilton"],
  ["canopy by hilton", "Hilton"],
  ["hilton hotels & resorts", "Hilton"],
  ["lxr hotels & resorts", "Hilton"],
  ["waldorf astoria hotels & resorts", "Hilton"],
  ["autograph collection hotels", "Marriott"],
  ["design hotels", "Marriott"],
  ["edition hotels", "Marriott"],
  ["jw marriott", "Marriott"],
  ["renaissance hotels", "Marriott"],
  ["ritz-carlton reserve", "Marriott"],
  ["st. regis", "Marriott"],
  ["the luxury collection", "Marriott"],
  ["the ritz-carlton", "Marriott"],
  ["w hotels", "Marriott"],
  ["westin hotels & resorts", "Marriott"],
  ["hotel indigo", "IHG Hotels & Resorts"],
  ["kimpton hotels & restaurants", "IHG Hotels & Resorts"],
  ["regent", "IHG Hotels & Resorts"],
  ["six senses", "IHG Hotels & Resorts"],
  ["gran meliá hotels & resorts", "Meliá Hotels & Resorts"],
  ["me by meliá", "Meliá Hotels & Resorts"],
  ["paradisus by meliá", "Meliá Hotels & Resorts"],
  ["fairmont", "Accor"],
  ["mgallery collection", "Accor"],
  ["raffles", "Accor"],
  ["so/", "Accor"],
  ["sofitel hotels & resorts", "Accor"],
  ["sofitel legend", "Accor"],
  ["swissôtel", "Accor"],
  ["anantara", "Minor Hotels"],
  ["nh collection hotels", "Minor Hotels"],
  ["tivoli hotels & resorts", "Minor Hotels"],
  ["mondrian", "Ennismore"],
  ["sls", "Ennismore"],
  ["the hoxton", "Ennismore"],
  ["1 hotels", "Starwood Hotels"],
  ["coraltree hospitality", "CoralTree Hospitality"],
  ["nomad", "Sydell Group"]
]);

const BRAND_PATTERNS = [
  [/hilton/u, "Hilton"],
  [/hyatt/u, "Hyatt"],
  [/marriott/u, "Marriott"],
  [/\bihg\b/u, "IHG Hotels & Resorts"],
  [/meli[aá]/u, "Meliá Hotels & Resorts"],
  [/sofitel|raffles|fairmont|swiss[ôo]tel|mgallery|pullman|novotel|mercure|ibis/u, "Accor"],
  [/anantara|tivoli|nh collection/u, "Minor Hotels"]
];

export function inferChainFromBrand(brand, chain = "") {
  const normalizedChain = normalizeString(chain);
  if (normalizedChain) {
    return normalizedChain;
  }

  const normalizedBrand = normalizeString(brand);
  if (!normalizedBrand) {
    return "";
  }

  const mappedChain = BRAND_TO_CHAIN.get(normalizedBrand.toLowerCase());
  if (mappedChain) {
    return mappedChain;
  }

  for (const [pattern, inferredChain] of BRAND_PATTERNS) {
    if (pattern.test(normalizedBrand)) {
      return inferredChain;
    }
  }

  return normalizedBrand;
}
