#!/usr/bin/env node
/**
 * Scan OpenStreetMap for bars, pubs, nightclubs and beer gardens in Bergen,
 * then merge them with the original curated Hectorskalaen entries.
 *
 * Usage:
 *   node scripts/fetch-bergen-bars.mjs
 *   node scripts/fetch-bergen-bars.mjs --from-file /tmp/bergen-bars.json
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BBOX = "60.29,5.14,60.54,5.55";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const QUERY = `[out:json][timeout:60];(nwr["amenity"~"^(bar|pub|nightclub|biergarten)$"](${BBOX}););out center tags;`;

/** Original titles → OSM names so editorial photos/copy survive a refresh. */
const CURATED_OSM_NAME = {
  "Gamle Hectors Hybel": "Hectors Hybel",
  Kråken: "Kråken",
  "Kulturhuset i Bergen": "Kulturhuset",
  "Henrik øl- og vinstove": "Henrik øl og vinstove",
  Rævadilter: "Rævedilter",
  "Fotballpubben": "Fotballpubben",
  Legal: "Legal",
  "Kvarteret - Grøndahls": "Grøndahl",
  "Folk & Røvere": "Folk og Røvere",
  Pappa: "Pappa",
};

/** Kulturhuset is tagged as a restaurant in OSM, so the amenity scan misses it. */
const EXTRA_OSM_ELEMENTS = [
  {
    type: "node",
    id: 3126099180,
    lat: 60.391402,
    lon: 5.321364,
    tags: {
      amenity: "bar",
      name: "Kulturhuset",
      website: "https://www.kulturhusetibergen.no",
    },
  },
];

function parseArgs(argv) {
  const fromFileIndex = argv.indexOf("--from-file");
  return {
    fromFile: fromFileIndex >= 0 ? argv[fromFileIndex + 1] : null,
  };
}

async function fetchOverpass() {
  let lastError;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(QUERY)}`,
      });
      if (!response.ok) {
        lastError = new Error(`${url} → HTTP ${response.status}`);
        continue;
      }
      const json = await response.json();
      if (!Array.isArray(json.elements)) {
        lastError = new Error(`${url} returned no elements`);
        continue;
      }
      return json;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("All Overpass endpoints failed");
}

function osmId(element) {
  return `osm-${element.type[0]}${element.id}`;
}

function coords(element) {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lon: element.lon };
  }
  if (element.center) {
    return { lat: element.center.lat, lon: element.center.lon };
  }
  return { lat: null, lon: null };
}

function toBar(element) {
  const tags = element.tags || {};
  const { lat, lon } = coords(element);
  const amenity = tags.amenity || "bar";
  return {
    id: osmId(element),
    title: tags.name,
    osmName: tags.name,
    amenity: amenity === "biergarten" ? "pub" : amenity,
    lat,
    lon,
    osmType: element.type,
    osmId: element.id,
    website: tags.website || tags["contact:website"] || null,
    openingHours: tags.opening_hours || null,
    picture: tags.image || null,
    pictureSource: tags.image ? "osm" : null,
    description: null,
    seedRating: null,
    curated: false,
  };
}

function indexByName(bars) {
  const map = new Map();
  for (const bar of bars) {
    const key = bar.osmName.toLowerCase();
    if (!map.has(key)) map.set(key, bar);
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const original = JSON.parse(
    await readFile(resolve(ROOT, "src/data/original-bars.json"), "utf8")
  );

  let osm;
  if (args.fromFile) {
    osm = JSON.parse(await readFile(resolve(args.fromFile), "utf8"));
  } else {
    osm = await fetchOverpass();
  }

  const elements = [...(osm.elements || [])];
  const existingIds = new Set(elements.map((el) => `${el.type}:${el.id}`));
  for (const extra of EXTRA_OSM_ELEMENTS) {
    if (!existingIds.has(`${extra.type}:${extra.id}`)) {
      elements.push(extra);
    }
  }

  const fromOsm = elements
    .filter((el) => el.tags && el.tags.name)
    .map(toBar)
    .filter((bar) => Number.isFinite(bar.lat) && Number.isFinite(bar.lon));

  const byName = indexByName(fromOsm);
  const usedIds = new Set();

  for (const curated of original) {
    const osmName = CURATED_OSM_NAME[curated.title];
    const match = osmName ? byName.get(osmName.toLowerCase()) : null;
    if (match) {
      match.title = curated.title;
      match.picture = curated.picture || null;
      match.pictureSource = curated.picture ? "curated" : null;
      match.description = curated.description || null;
      match.seedRating = curated.rating;
      match.curated = true;
      usedIds.add(match.id);
    } else {
      const slug = curated.title
        .toLowerCase()
        .replace(/[^a-z0-9æøå]+/gi, "-")
        .replace(/^-|-$/g, "");
      fromOsm.push({
        id: `curated-${slug}`,
        title: curated.title,
        osmName: null,
        amenity: "bar",
        lat: 60.391,
        lon: 5.323,
        osmType: null,
        osmId: null,
        website: null,
        openingHours: null,
        picture: curated.picture || null,
        pictureSource: curated.picture ? "curated" : null,
        description: curated.description || null,
        seedRating: curated.rating,
        curated: true,
      });
    }
  }

  let previousPictures = new Map();
  let previousImageMeta = {};
  try {
    const previous = JSON.parse(await readFile(resolve(ROOT, "src/bars.json"), "utf8"));
    previousImageMeta = {
      imagesFetchedAt: previous.meta?.imagesFetchedAt,
      imageSources: previous.meta?.imageSources,
    };
    for (const bar of previous.bars || []) {
      if (bar.picture) {
        previousPictures.set(bar.id, {
          picture: bar.picture,
          pictureSource: bar.pictureSource || null,
        });
      }
    }
  } catch {
    /* first catalog write */
  }

  fromOsm.sort((a, b) => {
    if (a.curated !== b.curated) return a.curated ? -1 : 1;
    return a.title.localeCompare(b.title, "nb");
  });

  for (const bar of fromOsm) {
    if (!bar.picture && previousPictures.has(bar.id)) {
      Object.assign(bar, previousPictures.get(bar.id));
    }
  }

  const catalog = {
    meta: {
      area: "Bergen, Norway",
      source: "OpenStreetMap Overpass API",
      license: "ODbL 1.0",
      bbox: BBOX,
      fetchedAt: new Date().toISOString(),
      barCount: fromOsm.length,
      note: "Editorial photos, descriptions and seedRating come from src/data/original-bars.json. Live community scores live in the ratings API. Venue photos are looked up with npm run fetch-images.",
      ...(previousImageMeta.imagesFetchedAt
        ? {
            imagesFetchedAt: previousImageMeta.imagesFetchedAt,
            imageSources: previousImageMeta.imageSources,
          }
        : {}),
    },
    bars: fromOsm,
  };

  const seeds = fromOsm
    .filter((bar) => typeof bar.seedRating === "number")
    .map((bar) => ({ id: bar.id, score: bar.seedRating }));

  await mkdir(resolve(ROOT, "api/data"), { recursive: true });
  await writeFile(
    resolve(ROOT, "src/bars.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    resolve(ROOT, "api/data/seeds.json"),
    `${JSON.stringify({ ids: fromOsm.map((b) => b.id), seeds }, null, 2)}\n`,
    "utf8"
  );

  const matched = original.filter((c) =>
    fromOsm.some((b) => b.curated && b.title === c.title && !b.id.startsWith("curated-"))
  ).length;
  console.log(
    `Wrote ${fromOsm.length} bars (${matched}/${original.length} curated matched to OSM).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
