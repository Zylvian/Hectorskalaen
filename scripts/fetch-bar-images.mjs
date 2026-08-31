#!/usr/bin/env node
/**
 * Attach a photo URL to every bar that is missing one.
 *
 * Sources, in order:
 *   1. OpenStreetMap image / wikimedia_commons / wikidata (P18)
 *   2. The bar's own website (og:image)
 *   3. Wikipedia page image, only if the page sits near the OSM coordinates
 *   4. Openverse (CC photos) with a name + Bergen match
 *   5. Carto/OSM neighborhood map tile of the venue coordinates (always available)
 *
 * Usage: node scripts/fetch-bar-images.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Hectorskalaen/1.0 (https://github.com/Zylvian/Hectorskalaen; bar catalog images)";
const BBOX = { south: 60.29, west: 5.14, north: 60.54, east: 5.55 };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  const stop = new Set(["the", "bar", "pub", "cafe", "kafe", "og", "and", "i", "in"]);
  return normalize(value)
    .split(" ")
    .filter((t) => t.length > 2 && !stop.has(t));
}

function nameOverlap(a, b) {
  const left = tokens(a);
  const right = new Set(tokens(b));
  if (!left.length) return 0;
  return left.filter((t) => right.has(t)).length / left.length;
}

function nearBergen(lat, lon, bar, maxKm = 0.35) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < BBOX.south || lat > BBOX.north || lon < BBOX.west || lon > BBOX.east) {
    return false;
  }
  const dLat = (lat - bar.lat) * 111;
  const dLon = (lon - bar.lon) * 111 * Math.cos((bar.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) <= maxKm;
}

function commonsFileUrl(filename) {
  let file = String(filename).replace(/^File:/i, "").replace(/ /g, "_");
  try {
    file = decodeURIComponent(file);
  } catch {
    /* already decoded */
  }
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=800`;
}

function looksLikeLogo(url) {
  return /logo|favicon|sprite|icon[-_]|placeholder|og\.png|_RGB/i.test(url);
}

function looksLikePhoto(url) {
  if (!url || looksLikeLogo(url)) return false;
  if (/^https?:\/\//i.test(url) === false) return false;
  if (/stolperstein|grindadrap|grave|memorial/i.test(url)) return false;
  if (/\.(jpe?g|webp|avif)(\?|$)/i.test(url) || /[?&](format|fm)=jpe?g/i.test(url)) return true;
  if (
    /squarespace|wixstatic|cloudinary|fbcdn|wp-content\/uploads/i.test(url) &&
    !/\.png(\?|$)/i.test(url)
  ) {
    return true;
  }
  return false;
}

function wikipediaTitleOk(bar, pageTitle) {
  const overlap = Math.max(nameOverlap(bar.title, pageTitle), nameOverlap(bar.osmName, pageTitle));
  if (overlap < 0.8) return false;
  const allowed = new Set([...tokens(`${bar.title} ${bar.osmName} bergen`), "bar", "pub", "platebar", "nightclub", "kro"]);
  const extra = tokens(pageTitle).filter((t) => !allowed.has(t));
  if (tokens(bar.title).length <= 1) return extra.length === 0;
  return extra.length <= 1;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return { html: await response.text(), finalUrl: response.url };
}

function mapTileUrl(lat, lon, zoom = 18) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
  return `https://basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}@2x.png`;
}

function mapPicture(bar) {
  return {
    picture: `${mapTileUrl(bar.lat, bar.lon)}?bar=${encodeURIComponent(bar.id)}`,
    pictureSource: "map",
  };
}

async function urlWorks(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Range: "bytes=0-1023" },
      redirect: "follow",
    });
    if (!response.ok) return false;
    const type = response.headers.get("content-type") || "";
    return /^image\//i.test(type);
  } catch {
    return false;
  }
}

async function acceptPicture(bar, hit, usedUrls) {
  if (!hit?.picture) return false;
  if (hit.pictureSource !== "map" && usedUrls.has(hit.picture)) return false;
  if (hit.pictureSource !== "map" && !(await urlWorks(hit.picture))) return false;
  Object.assign(bar, hit);
  if (hit.pictureSource !== "map") usedUrls.add(hit.picture);
  return true;
}

async function fromOverpass(bars) {
  const query = `[out:json][timeout:60];(nwr["amenity"~"^(bar|pub|nightclub|biergarten)$"](60.29,5.14,60.54,5.55););out center tags;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
  ];
  let elements = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) continue;
      const json = await response.json();
      elements = json.elements || [];
      break;
    } catch {
      /* try next */
    }
  }
  const byOsm = new Map();
  for (const el of elements) {
    byOsm.set(`${el.type[0]}${el.id}`, el.tags || {});
  }
  const found = new Map();
  for (const bar of bars) {
    if (!bar.osmType || !bar.osmId) continue;
    const tags = byOsm.get(`${bar.osmType[0]}${bar.osmId}`) || {};
    if (tags.image && looksLikePhoto(tags.image)) {
      found.set(bar.id, { picture: tags.image, pictureSource: "osm" });
    } else if (tags.wikimedia_commons) {
      found.set(bar.id, {
        picture: commonsFileUrl(tags.wikimedia_commons),
        pictureSource: "osm",
      });
    } else if (tags.wikidata) {
      const qid = tags.wikidata;
      try {
        const data = await fetchJson(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=claims&format=json`
        );
        const file = data.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (file) {
          found.set(bar.id, { picture: commonsFileUrl(file), pictureSource: "wikidata" });
        }
        await sleep(150);
      } catch {
        /* ignore */
      }
    }
  }
  return found;
}

function extractOgImage(html, baseUrl) {
  const patterns = [
    /property=["']og:image["']\s+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["']\s+property=["']og:image["']/i,
    /property=["']og:image:url["']\s+content=["']([^"']+)["']/i,
    /name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
    /content=["']([^"']+)["']\s+name=["']twitter:image["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      return new URL(match[1], baseUrl).href;
    } catch {
      return match[1];
    }
  }
  return null;
}

async function fromWebsite(bar) {
  if (!bar.website) return null;
  try {
    const { html, finalUrl } = await fetchText(bar.website);
    const image = extractOgImage(html, finalUrl);
    if (image && looksLikePhoto(image) && !looksLikeLogo(image)) {
      return { picture: image, pictureSource: "website" };
    }
  } catch {
    return null;
  }
  return null;
}

async function fromWikipedia(bar) {
  const query = encodeURIComponent(`"${bar.osmName || bar.title}" Bergen`);
  for (const lang of ["no", "en"]) {
    try {
      const data = await fetchJson(
        `https://${lang}.wikipedia.org/w/api.php?action=query&format=json` +
          `&generator=search&gsrsearch=${query}&gsrlimit=5` +
          `&prop=pageimages|coordinates&piprop=thumbnail&pithumbsize=800&pilicense=any`
      );
      const pages = Object.values(data.query?.pages || {});
      for (const page of pages) {
        const thumb = page.thumbnail?.source;
        const coord = page.coordinates?.[0];
        if (!thumb) continue;
        if (!wikipediaTitleOk(bar, page.title)) continue;
        if (coord && nearBergen(coord.lat, coord.lon, bar, 0.4)) {
          return { picture: thumb.split("?")[0], pictureSource: "wikipedia" };
        }
      }
    } catch {
      /* next language */
    }
    await sleep(200);
  }
  return null;
}

async function fromOpenverse(bar) {
  const query = encodeURIComponent(`${bar.osmName || bar.title} Bergen`);
  try {
    const data = await fetchJson(`https://api.openverse.org/v1/images/?q=${query}&page_size=8`);
    for (const hit of data.results || []) {
      const hay = `${hit.title || ""} ${hit.tags?.map((t) => t.name).join(" ") || ""}`;
      if (/stolperstein|grindadrap|grave|memorial|under dekk|ds /i.test(hay)) continue;
      if (nameOverlap(bar.title, hay) < 0.7) continue;
      if (!/bergen/i.test(hay)) continue;
      const url = hit.url || hit.thumbnail;
      if (url && looksLikePhoto(url)) {
        return { picture: url, pictureSource: "openverse" };
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function main() {
  const catalogPath = resolve(ROOT, "src/bars.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const usedUrls = new Set(
    catalog.bars.filter((bar) => bar.curated && bar.picture).map((bar) => bar.picture)
  );
  for (const bar of catalog.bars) {
    if (bar.curated) continue;
    if (bar.pictureSource === "map") {
      if (/maps\.wikimedia\.org/i.test(bar.picture || "")) {
        Object.assign(bar, mapPicture(bar));
      }
      continue;
    }
    if (!bar.picture) continue;
    const badUrl =
      !looksLikePhoto(bar.picture) ||
      /stolperstein|grindadrap|lungeg|under_dekk|under%20dekk/i.test(bar.picture);
    if (badUrl || usedUrls.has(bar.picture) || !(await urlWorks(bar.picture))) {
      bar.picture = null;
      bar.pictureSource = null;
    } else {
      usedUrls.add(bar.picture);
    }
  }
  const missing = catalog.bars.filter((bar) => !bar.picture);
  console.log(`Looking up images for ${missing.length} bars…`);

  const osmHits = await fromOverpass(missing);
  console.log(`OSM/Wikidata hits: ${osmHits.size}`);

  let found = 0;
  for (const bar of catalog.bars) {
    if (bar.picture) continue;
    if (osmHits.has(bar.id) && (await acceptPicture(bar, osmHits.get(bar.id), usedUrls))) {
      found += 1;
      continue;
    }
    const website = await fromWebsite(bar);
    await sleep(120);
    if (await acceptPicture(bar, website, usedUrls)) {
      found += 1;
      continue;
    }
    const wiki = await fromWikipedia(bar);
    if (await acceptPicture(bar, wiki, usedUrls)) {
      found += 1;
      continue;
    }
    const openverse = await fromOpenverse(bar);
    await sleep(200);
    if (await acceptPicture(bar, openverse, usedUrls)) {
      found += 1;
      continue;
    }
    Object.assign(bar, mapPicture(bar));
    found += 1;
  }

  const sources = {};
  for (const bar of catalog.bars) {
    const key = bar.pictureSource || (bar.picture ? "existing" : "none");
    sources[key] = (sources[key] || 0) + 1;
  }
  catalog.meta.note =
    "Editorial photos, descriptions and seedRating come from src/data/original-bars.json. Live community scores live in the ratings API. Venue photos are looked up with npm run fetch-images.";
  catalog.meta.imagesFetchedAt = new Date().toISOString();
  catalog.meta.imageSources = sources;

  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log("Image sources:", sources);
  console.log(`Updated ${found} missing pictures.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
