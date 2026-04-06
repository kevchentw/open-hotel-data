import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { inferChainFromBrand } from "../../shared/brand-chain.mjs";

const SOURCE = "chase_edit";
const PLAN_NAME = "Chase Edit";
const SOURCE_URL = "https://awardhelper.com/csr-hotels";
const OUTPUT_FILE_URL = new URL("../chase-edit-hotel.json", import.meta.url);
const OUTPUT_DIRECTORY_URL = new URL("../", import.meta.url);

const COUNTRY_CODES = new Map([
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["IT", "Italy"],
  ["ES", "Spain"],
  ["JP", "Japan"],
  ["CN", "China"],
  ["AU", "Australia"],
  ["MX", "Mexico"],
  ["BR", "Brazil"],
  ["AR", "Argentina"],
  ["CL", "Chile"],
  ["CO", "Colombia"],
  ["PE", "Peru"],
  ["IN", "India"],
  ["TH", "Thailand"],
  ["ID", "Indonesia"],
  ["MY", "Malaysia"],
  ["SG", "Singapore"],
  ["PH", "Philippines"],
  ["VN", "Vietnam"],
  ["KR", "South Korea"],
  ["HK", "Hong Kong"],
  ["TW", "Taiwan"],
  ["NZ", "New Zealand"],
  ["ZA", "South Africa"],
  ["KE", "Kenya"],
  ["MA", "Morocco"],
  ["EG", "Egypt"],
  ["NG", "Nigeria"],
  ["GH", "Ghana"],
  ["TZ", "Tanzania"],
  ["UG", "Uganda"],
  ["ET", "Ethiopia"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"],
  ["IL", "Israel"],
  ["TR", "Turkey"],
  ["GR", "Greece"],
  ["PT", "Portugal"],
  ["NL", "Netherlands"],
  ["BE", "Belgium"],
  ["CH", "Switzerland"],
  ["AT", "Austria"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["FI", "Finland"],
  ["PL", "Poland"],
  ["CZ", "Czech Republic"],
  ["HU", "Hungary"],
  ["RO", "Romania"],
  ["HR", "Croatia"],
  ["RS", "Serbia"],
  ["BG", "Bulgaria"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["BA", "Bosnia and Herzegovina"],
  ["MK", "North Macedonia"],
  ["AL", "Albania"],
  ["ME", "Montenegro"],
  ["XK", "Kosovo"],
  ["IE", "Ireland"],
  ["IS", "Iceland"],
  ["LU", "Luxembourg"],
  ["MT", "Malta"],
  ["CY", "Cyprus"],
  ["MC", "Monaco"],
  ["LI", "Liechtenstein"],
  ["AD", "Andorra"],
  ["SM", "San Marino"],
  ["VA", "Vatican City"],
  ["RU", "Russia"],
  ["UA", "Ukraine"],
  ["BY", "Belarus"],
  ["MD", "Moldova"],
  ["GE", "Georgia"],
  ["AM", "Armenia"],
  ["AZ", "Azerbaijan"],
  ["KZ", "Kazakhstan"],
  ["UZ", "Uzbekistan"],
  ["TM", "Turkmenistan"],
  ["TJ", "Tajikistan"],
  ["KG", "Kyrgyzstan"],
  ["MN", "Mongolia"],
  ["AF", "Afghanistan"],
  ["PK", "Pakistan"],
  ["BD", "Bangladesh"],
  ["LK", "Sri Lanka"],
  ["NP", "Nepal"],
  ["BT", "Bhutan"],
  ["MM", "Myanmar"],
  ["KH", "Cambodia"],
  ["LA", "Laos"],
  ["TL", "Timor-Leste"],
  ["BN", "Brunei"],
  ["MV", "Maldives"],
  ["MU", "Mauritius"],
  ["RE", "Réunion"],
  ["SC", "Seychelles"],
  ["CV", "Cape Verde"],
  ["ST", "São Tomé and Príncipe"],
  ["MG", "Madagascar"],
  ["MZ", "Mozambique"],
  ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"],
  ["BW", "Botswana"],
  ["NA", "Namibia"],
  ["SZ", "Eswatini"],
  ["LS", "Lesotho"],
  ["MW", "Malawi"],
  ["CI", "Côte d'Ivoire"],
  ["SN", "Senegal"],
  ["CM", "Cameroon"],
  ["TN", "Tunisia"],
  ["LY", "Libya"],
  ["DZ", "Algeria"],
  ["SD", "Sudan"],
  ["SO", "Somalia"],
  ["ER", "Eritrea"],
  ["DJ", "Djibouti"],
  ["RW", "Rwanda"],
  ["BI", "Burundi"],
  ["CD", "Democratic Republic of the Congo"],
  ["CG", "Republic of the Congo"],
  ["GA", "Gabon"],
  ["GQ", "Equatorial Guinea"],
  ["AO", "Angola"],
  ["ZZ", "Unknown"],
  ["DO", "Dominican Republic"],
  ["PR", "Puerto Rico"],
  ["CU", "Cuba"],
  ["JM", "Jamaica"],
  ["HT", "Haiti"],
  ["TT", "Trinidad and Tobago"],
  ["BB", "Barbados"],
  ["LC", "Saint Lucia"],
  ["VC", "Saint Vincent and the Grenadines"],
  ["GD", "Grenada"],
  ["AG", "Antigua and Barbuda"],
  ["KN", "Saint Kitts and Nevis"],
  ["DM", "Dominica"],
  ["BS", "Bahamas"],
  ["TC", "Turks and Caicos Islands"],
  ["KY", "Cayman Islands"],
  ["VI", "U.S. Virgin Islands"],
  ["VG", "British Virgin Islands"],
  ["AW", "Aruba"],
  ["CW", "Curaçao"],
  ["BQ", "Caribbean Netherlands"],
  ["SX", "Sint Maarten"],
  ["MF", "Saint Martin"],
  ["GP", "Guadeloupe"],
  ["MQ", "Martinique"],
  ["BL", "Saint Barthélemy"],
  ["GT", "Guatemala"],
  ["BZ", "Belize"],
  ["HN", "Honduras"],
  ["SV", "El Salvador"],
  ["NI", "Nicaragua"],
  ["CR", "Costa Rica"],
  ["PA", "Panama"],
  ["UY", "Uruguay"],
  ["PY", "Paraguay"],
  ["BO", "Bolivia"],
  ["EC", "Ecuador"],
  ["VE", "Venezuela"],
  ["GY", "Guyana"],
  ["SR", "Suriname"],
  ["GF", "French Guiana"],
  ["FK", "Falkland Islands"],
  ["PF", "French Polynesia"],
  ["NC", "New Caledonia"],
  ["FJ", "Fiji"],
  ["WS", "Samoa"],
  ["TO", "Tonga"],
  ["VU", "Vanuatu"],
  ["PG", "Papua New Guinea"],
  ["SB", "Solomon Islands"],
  ["KI", "Kiribati"],
  ["FM", "Micronesia"],
  ["MH", "Marshall Islands"],
  ["PW", "Palau"],
  ["NR", "Nauru"],
  ["TV", "Tuvalu"],
  ["WF", "Wallis and Futuna"],
  ["CK", "Cook Islands"],
  ["NU", "Niue"],
  ["TK", "Tokelau"],
  ["AS", "American Samoa"],
  ["GU", "Guam"],
  ["MP", "Northern Mariana Islands"],
]);

function normalizeCountryCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) {
    return "";
  }

  return COUNTRY_CODES.get(code) ?? code;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function extractHotelPayload(html) {
  // Next.js App Router embeds data via self.__next_f.push([1,"..."]) calls
  const pushMatches = [...html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)];
  for (const pushMatch of pushMatches) {
    if (!pushMatch[1].includes("chase_2026_credit")) {
      continue;
    }

    try {
      const raw = JSON.parse(`"${pushMatch[1]}"`);
      const hotels = extractHotelsFromFlightSegment(raw);
      if (hotels) {
        return hotels;
      }
    } catch {
      // try next push
    }
  }

  // Fallback: Next.js Pages Router __NEXT_DATA__
  const nextDataMatch = html.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})(?:\s*<\/script>)/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const props = nextData?.props?.pageProps;
      if (Array.isArray(props?.hotels)) {
        return props.hotels;
      }
      if (Array.isArray(props?.data?.hotels)) {
        return props.data.hotels;
      }
    } catch {
      // fall through
    }
  }

  return null;
}

function extractHotelsFromFlightSegment(raw) {
  const hotelsKey = `"hotels":[`;
  const keyIndex = raw.indexOf(hotelsKey);
  if (keyIndex === -1) {
    return null;
  }

  const arrayStart = keyIndex + hotelsKey.length - 1;
  let depth = 0;
  let arrayEnd = arrayStart;

  for (let index = arrayStart; index < raw.length; index++) {
    if (raw[index] === "[") {
      depth++;
    } else if (raw[index] === "]") {
      depth--;
      if (depth === 0) {
        arrayEnd = index;
        break;
      }
    }
  }

  try {
    const parsed = JSON.parse(raw.slice(arrayStart, arrayEnd + 1));
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.id) {
      return parsed;
    }
  } catch {
    // malformed
  }

  return null;
}

export async function collectHotels() {
  const html = await fetchPage(SOURCE_URL);
  const rawHotels = extractHotelPayload(html);

  if (!rawHotels) {
    throw new Error("Could not extract hotel payload from Award Helper page HTML");
  }

  console.log(`Found ${rawHotels.length} total hotels in Award Helper payload`);

  const eligible = rawHotels.filter((hotel) => hotel?.id);
  const withCredit = eligible.filter((hotel) => hotel?.chase_2026_credit === "TRUE" || hotel?.chase_2026_credit === true);

  console.log(`Including all ${eligible.length} hotels (${withCredit.length} with chase_2026_credit=TRUE)`);

  return eligible.map(toStageOneHotel);
}

export async function writeStageOneOutputs() {
  await mkdir(OUTPUT_DIRECTORY_URL, { recursive: true });

  console.log(`Fetching Award Helper Chase Edit hotels from ${SOURCE_URL}`);
  const hotels = await collectHotels();
  const generatedAt = new Date().toISOString();
  const payload = buildStagePayload(hotels, generatedAt);

  await writeFile(OUTPUT_FILE_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${payload.metadata.record_count} Chase Edit hotels (all, regardless of chase_2026_credit) to ${OUTPUT_FILE_URL.pathname}`);

  return payload;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Award Helper page: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function toStageOneHotel(hotel) {
  const id = normalizeString(hotel.id);
  const brand = normalizeString(hotel.brand);

  return {
    source: SOURCE,
    source_hotel_id: id,
    name: normalizeString(hotel.name),
    address_raw: normalizeString(hotel.address),
    city: normalizeString(hotel.city),
    state_region: normalizeString(hotel.state),
    country: normalizeCountryCode(hotel.country),
    url: id ? `https://travelsecure.chase.com/details/hotels/deeplink/${id}` : "",
    plan: PLAN_NAME,
    brand,
    chain: inferChainFromBrand(brand),
    latitude: normalizeString(hotel.latitude),
    longitude: normalizeString(hotel.longitude),
    michelin_keys: normalizeString(hotel.michelin_keys),
    chase_2026_credit: normalizeString(hotel.chase_2026_credit),
    source_rating: normalizeString(hotel.rating),
    added_date: normalizeString(hotel.added_date),
    collected_at: new Date().toISOString(),
  };
}

function buildStagePayload(hotels, generatedAt) {
  const entries = hotels
    .filter((hotel) => hotel.source_hotel_id)
    .sort((left, right) => left.source_hotel_id.localeCompare(right.source_hotel_id));

  return {
    metadata: {
      stage: "1-list",
      source: SOURCE,
      generated_at: generatedAt,
      record_count: entries.length,
      source_url: SOURCE_URL,
    },
    hotels: Object.fromEntries(entries.map((hotel) => [hotel.source_hotel_id, hotel])),
  };
}

async function main() {
  await writeStageOneOutputs();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
