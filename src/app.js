(() => {
  const SCALE_LABELS = [
    "Parfyme",
    "Friskt",
    "Stue",
    "Gammelt øl",
    "Kjeller",
    "Svette",
    "Pissoir",
    "Offentlig do",
    "Utholdelig",
    "Piss",
  ];

  const AMENITY_LABEL = {
    bar: "Bar",
    pub: "Pub",
    nightclub: "Nattklubb",
  };

  const VISITOR_KEY = "hectorskalaen.visitorId";
  const MY_RATINGS_KEY = "hectorskalaen.myRatings";
  const COMMENT_MAX = 280;
  /** Torgallmenningen / Vågen. Outliers stay on the map but do not pull the start view. */
  const MAP_DEFAULT_CENTER = [60.3935, 5.3238];
  const MAP_DEFAULT_ZOOM = 15;

  /** @type {Array<any>} */
  let bars = [];
  /** @type {Record<string, {average: number|null, count: number, histogram: number[], comments?: Array<{score:number, comment:string}>}>} */
  let ratings = {};
  let searchQuery = "";
  let sortMode = "worst";
  let viewMode = "map";
  let amenityFilter = "all";
  let rankingFilter = "rated";
  let commentSort = "upvotes";
  let hiddenCommentsOpen = false;
  let commentVoteBusy = false;
  let userLocation = null;
  let map = null;
  let mapMarkers = [];
  let mapFitKey = "";
  let selectedMapBarId = null;
  let persistence = "unknown";

  const searchInput = document.getElementById("searchInput");
  const barsList = document.getElementById("barsList");
  const resultsSummary = document.getElementById("resultsSummary");
  const amenityFilterEl = document.getElementById("amenityFilter");
  const sortSelect = document.getElementById("sortSelect");
  const viewGridBtn = document.getElementById("viewGrid");
  const viewListBtn = document.getElementById("viewList");
  const viewMapBtn = document.getElementById("viewMap");
  const tabRated = document.getElementById("tabRated");
  const tabUnrated = document.getElementById("tabUnrated");
  const filtersToggle = document.getElementById("filtersToggle");
  const filtersClose = document.getElementById("filtersClose");
  const filtersScrim = document.getElementById("filtersScrim");
  const filtersDrawer = document.getElementById("filtersDrawer");
  const mapPanel = document.getElementById("mapPanel");
  const listWrapper = document.querySelector(".bars-scroll-wrapper");
  const barDialog = document.getElementById("barDialog");
  const aboutToggle = document.getElementById("aboutToggle");
  const aboutDialog = document.getElementById("aboutDialog");
  const dialogScrim = document.getElementById("dialogScrim");
  const dialogBody = document.getElementById("dialogBody");
  const persistenceNote = document.getElementById("persistenceNote");

  const gameSummary = document.getElementById("gameSummary");
  const gameImage = document.getElementById("gameImage");
  const gameTitle = document.getElementById("gameTitle");
  const gameHint = document.getElementById("gameHint");
  const guessInput = document.getElementById("guessInput");
  const guessSubmit = document.getElementById("guessSubmit");
  const guessFeedback = document.getElementById("guessFeedback");
  const isGamePage = Boolean(document.querySelector(".panel-game") && !barsList);

  let currentGameBar = null;
  let gameAttempts = 0;

  function visitorId() {
    try {
      const existing = localStorage.getItem(VISITOR_KEY);
      if (existing && /^[a-z0-9-]{8,64}$/i.test(existing)) return existing;
      const created =
        crypto.randomUUID?.() ||
        `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(VISITOR_KEY, created);
      return created;
    } catch {
      return `session-${Date.now().toString(36)}`;
    }
  }

  function loadMyRatings() {
    try {
      return JSON.parse(localStorage.getItem(MY_RATINGS_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function myVote(barId) {
    const value = loadMyRatings()[barId];
    if (typeof value === "number") return { score: value, comment: "" };
    if (value && typeof value.score === "number") {
      return {
        score: value.score,
        comment: typeof value.comment === "string" ? value.comment : "",
      };
    }
    return null;
  }

  function saveMyRating(barId, score, comment) {
    const all = loadMyRatings();
    all[barId] = { score, comment: comment || "" };
    localStorage.setItem(MY_RATINGS_KEY, JSON.stringify(all));
  }

  function ratingColor(rating) {
    const clamped = Math.min(10, Math.max(1, Number(rating) || 1));
    const t = (clamped - 1) / 9;
    const hue = 120 - t * 120;
    const sat = 50 + t * 12;
    const light = 68 - t * 8;
    return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
  }

  function roundToTenth(value) {
    return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
  }

  function averageFromHistogram(histogram) {
    if (!Array.isArray(histogram) || histogram.length < 10) return null;
    let sum = 0;
    let count = 0;
    for (let score = 1; score <= 10; score += 1) {
      const n = Number(histogram[score - 1]) || 0;
      sum += score * n;
      count += n;
    }
    if (count <= 0) return null;
    return roundToTenth(sum / count);
  }

  function displayScore(bar) {
    const live = ratings[bar.id];
    if (live && live.count > 0 && typeof live.average === "number") {
      const average = averageFromHistogram(live.histogram) ?? roundToTenth(live.average);
      return { ...live, average, comments: live.comments || [] };
    }
    if (typeof bar.seedRating === "number") {
      return {
        average: bar.seedRating,
        count: 0,
        histogram: null,
        comments: [],
        seeded: true,
      };
    }
    return { average: null, count: 0, histogram: null, comments: [] };
  }

  function isRated(bar) {
    return displayScore(bar).average != null;
  }

  function roundedAverage(bar) {
    const stats = displayScore(bar);
    if (stats.average == null) return null;
    return Math.min(10, Math.max(1, Math.round(stats.average)));
  }

  function amenityLabel(amenity) {
    return AMENITY_LABEL[amenity] || "Utested";
  }

  function formatAverage(value) {
    if (value == null || !Number.isFinite(Number(value))) return "–";
    const rounded = roundToTenth(value);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function haversineKm(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const h =
      sinLat * sinLat +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    } catch {
      /* ignore */
    }
    return null;
  }

  function initial(title) {
    const trimmed = (title || "?").trim();
    return trimmed.charAt(0).toUpperCase();
  }

  function hueFromName(title) {
    let hash = 0;
    for (let i = 0; i < title.length; i += 1) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
  }

  function filteredBars() {
    const query = searchQuery.trim().toLowerCase();
    let next = bars.slice();
    if (amenityFilter !== "all") {
      next = next.filter((bar) => bar.amenity === amenityFilter);
    }
    next = next.filter((bar) => (rankingFilter === "rated" ? isRated(bar) : !isRated(bar)));
    if (query) {
      next = next.filter((bar) => {
        const hay = `${bar.title} ${bar.osmName || ""} ${bar.description || ""}`.toLowerCase();
        return hay.includes(query);
      });
    }
    if (sortMode === "unrated") {
      next = next.filter((bar) => !isRated(bar));
    }

    const scoreOr = (bar, fallback) => {
      const avg = displayScore(bar).average;
      return avg == null ? fallback : avg;
    };

    next.sort((a, b) => {
      if (sortMode === "worst") {
        const diff = scoreOr(b, -1) - scoreOr(a, -1);
        return diff !== 0 ? diff : a.title.localeCompare(b.title, "nb");
      }
      if (sortMode === "best") {
        const aScore = scoreOr(a, 99);
        const bScore = scoreOr(b, 99);
        const diff = aScore - bScore;
        return diff !== 0 ? diff : a.title.localeCompare(b.title, "nb");
      }
      if (sortMode === "votes") {
        return displayScore(b).count - displayScore(a).count || a.title.localeCompare(b.title, "nb");
      }
      if (sortMode === "likes") {
        const likes = (bar) =>
          (displayScore(bar).comments || []).reduce(
            (sum, item) => sum + (Number(item.upvotes) || 0),
            0
          );
        return likes(b) - likes(a) || a.title.localeCompare(b.title, "nb");
      }
      if (sortMode === "near" && userLocation) {
        return (
          haversineKm(userLocation, a) - haversineKm(userLocation, b) ||
          a.title.localeCompare(b.title, "nb")
        );
      }
      return a.title.localeCompare(b.title, "nb");
    });
    return next;
  }

  function updateStats() {
    const statBars = document.getElementById("statBars");
    const statVotes = document.getElementById("statVotes");
    const statWorst = document.getElementById("statWorst");
    if (!statBars) return;

    const voteTotal = Object.values(ratings).reduce((sum, item) => sum + (item.count || 0), 0);
    let worst = null;
    for (const bar of bars) {
      const stats = displayScore(bar);
      if (stats.average == null) continue;
      if (!worst || stats.average > worst.average) {
        worst = { title: bar.title, average: stats.average };
      }
    }
    statBars.textContent = String(bars.length);
    statVotes.textContent = String(voteTotal);
    statWorst.textContent = worst ? formatAverage(worst.average) : "–";
    const worstName = document.getElementById("statWorstName");
    if (worstName) {
      worstName.textContent = worst ? worst.title : "Ingen score ennå";
      worstName.title = worst ? `${worst.title} ligger høyest på Hectorskalaen` : "";
    }
  }

  function createMonogram(bar) {
    const el = document.createElement("div");
    el.className = "bar-monogram";
    el.textContent = initial(bar.title);
    el.style.background = `linear-gradient(160deg, hsl(${hueFromName(bar.title)} 28% 18%), #14151c)`;
    return el;
  }

  function createMedia(bar, stats) {
    const media = document.createElement("div");
    media.className = "bar-media";
    if (bar.picture) {
      const image = document.createElement("img");
      image.className = "bar-image";
      image.src = bar.picture;
      image.alt = bar.title;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        image.remove();
        media.prepend(createMonogram(bar));
      });
      media.appendChild(image);
    } else {
      media.appendChild(createMonogram(bar));
    }

    const overlay = document.createElement("div");
    overlay.className = "bar-rating-overlay";
    const scored = stats.average != null;
    overlay.setAttribute("aria-label", scored ? `${formatAverage(stats.average)} av 10` : "Ingen score ennå");
    if (scored) {
      const color = ratingColor(stats.average);
      overlay.style.setProperty("--overlay-glow", color);
      overlay.style.setProperty("--score-color", color);
    } else {
      overlay.classList.add("bar-rating-overlay--empty");
    }
    const number = document.createElement("span");
    number.className = "bar-rating-overlay-number";
    number.textContent = scored ? formatAverage(stats.average) : "?";
    if (scored && String(number.textContent).includes(".")) {
      overlay.classList.add("bar-rating-overlay--decimal");
    }
    const label = document.createElement("span");
    label.className = "bar-rating-overlay-label";
    label.textContent = "/10";
    overlay.append(number, label);
    media.appendChild(overlay);
    return media;
  }

  function createBarElement(bar) {
    const stats = displayScore(bar);
    const mine = myVote(bar.id);
    const li = document.createElement("li");
    li.className = "bar-card";
    li.classList.add(viewMode === "list" ? "bar-card--list" : "bar-card--grid");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "bar-card-button";
    button.setAttribute("aria-label", `Åpne ${bar.title}`);

    button.appendChild(createMedia(bar, stats));

    const info = document.createElement("div");
    info.className = "bar-info";
    const titleEl = document.createElement("h3");
    titleEl.className = "bar-title";
    titleEl.textContent = bar.title;
    const meta = document.createElement("p");
    meta.className = "bar-meta-line";
    const votes = stats.count > 0 ? `${stats.count} stemme${stats.count === 1 ? "" : "r"}` : "Ingen stemmer ennå";
    meta.textContent = `${amenityLabel(bar.amenity)} · ${votes}`;
    info.append(titleEl, meta);
    if (bar.description) {
      const desc = document.createElement("p");
      desc.className = "bar-description";
      desc.textContent = bar.description;
      info.appendChild(desc);
    }
    if (mine) {
      const yours = document.createElement("p");
      yours.className = "bar-yours";
      yours.textContent = mine.comment
        ? `Du ga ${mine.score}/10 — «${mine.comment}»`
        : `Du ga ${mine.score}/10`;
      info.appendChild(yours);
    }
    button.appendChild(info);
    button.addEventListener("click", () => openBar(bar.id));
    li.appendChild(button);
    return li;
  }

  function updateRankTabs() {
    const ratedCount = bars.filter(isRated).length;
    const unratedCount = bars.length - ratedCount;
    if (tabRated) {
      tabRated.textContent = `Med score (${ratedCount})`;
      tabRated.classList.toggle("btn-toggle--active", rankingFilter === "rated");
      tabRated.setAttribute("aria-selected", rankingFilter === "rated" ? "true" : "false");
    }
    if (tabUnrated) {
      tabUnrated.textContent = `Uten score (${unratedCount})`;
      tabUnrated.classList.toggle("btn-toggle--active", rankingFilter === "unrated");
      tabUnrated.setAttribute("aria-selected", rankingFilter === "unrated" ? "true" : "false");
    }
    return { ratedCount, unratedCount };
  }

  function renderList() {
    if (!barsList || !resultsSummary) return;
    barsList.classList.toggle("bars-list--grid", viewMode === "grid");
    const filtered = filteredBars();
    const { ratedCount, unratedCount } = updateRankTabs();
    const query = searchQuery.trim();
    if (!filtered.length) {
      resultsSummary.textContent = query
        ? `Ingen barer matcher «${query}».`
        : rankingFilter === "rated"
          ? "Ingen barer med score ennå."
          : "Alle barer har fått score.";
    } else if (query) {
      const pool = rankingFilter === "rated" ? "vurderte" : "uavklarte";
      resultsSummary.textContent = `${filtered.length} av ${
        rankingFilter === "rated" ? ratedCount : unratedCount
      } ${pool} barer matcher «${query}».`;
    } else {
      resultsSummary.textContent =
        rankingFilter === "rated"
          ? `${filtered.length} utesteder med score på Hectorskalaen.`
          : `${filtered.length} utesteder uten score ennå.`;
    }

    barsList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    filtered.forEach((bar) => fragment.appendChild(createBarElement(bar)));
    barsList.appendChild(fragment);
  }

  function clearMapMarkers() {
    mapMarkers.forEach((marker) => marker.remove());
    mapMarkers = [];
  }

  function mapPinIcon(bar, stats, color) {
    const label = stats.average == null ? "?" : formatAverage(stats.average);
    const selected = selectedMapBarId === bar.id ? " is-selected" : "";
    const decimal = label.includes(".") ? " map-pin--decimal" : "";
    return L.divIcon({
      className: "map-pin-wrap",
      iconSize: [36, 46],
      iconAnchor: [18, 44],
      tooltipAnchor: [0, -42],
      html: `<div class="map-pin${selected}${decimal}" data-bar-id="${escapeHtml(bar.id)}" style="--pin-color:${color}"><span>${escapeHtml(label)}</span></div>`,
    });
  }

  function mapHoverHtml(bar, stats, color) {
    const picture = bar.picture
      ? `<img class="map-hover-image" src="${escapeHtml(bar.picture)}" alt="${escapeHtml(bar.title)}" loading="lazy" referrerpolicy="no-referrer">`
      : `<div class="map-hover-image map-hover-image--empty">${escapeHtml(initial(bar.title))}</div>`;
    const votes =
      stats.average == null
        ? "Ingen score ennå"
        : `${stats.count} ${stats.count === 1 ? "stemme" : "stemmer"}`;
    return `<div class="map-hover-card">
      ${picture}
      <div class="map-hover-copy">
        <strong>${escapeHtml(bar.title)}</strong>
        <span class="map-hover-score" style="color:${color}">${formatAverage(stats.average)}/10</span>
        <span class="map-hover-meta">${escapeHtml(votes)} · klikk for kommentarer</span>
      </div>
    </div>`;
  }

  function renderMap() {
    if (listWrapper) listWrapper.hidden = true;
    if (mapPanel) mapPanel.hidden = false;
    if (typeof L === "undefined") {
      if (resultsSummary) {
        resultsSummary.textContent = "Kartet kunne ikke lastes. Prøv rutenett-visning.";
      }
      return;
    }

    const draw = () => {
      const el = document.getElementById("map");
      if (!el) return;
      if (!map) {
        map = L.map(el, {
          scrollWheelZoom: true,
          zoomControl: false,
        }).setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM);
        L.control.zoom({ position: "bottomright" }).addTo(map);
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          attribution:
            "Tiles &copy; Esri — Source: Esri, TomTom, Garmin, FAO, NOAA, USGS",
        }).addTo(map);
      }
      map.invalidateSize();
      clearMapMarkers();
      const filtered = filteredBars();
      const bounds = [];
      filtered.forEach((bar) => {
        if (!Number.isFinite(bar.lat) || !Number.isFinite(bar.lon)) return;
        const stats = displayScore(bar);
        const color = stats.average == null ? "#e7c14f" : ratingColor(stats.average);
        const marker = L.marker([bar.lat, bar.lon], {
          icon: mapPinIcon(bar, stats, color),
          riseOnHover: true,
          keyboard: true,
        }).addTo(map);
        marker.bindTooltip(mapHoverHtml(bar, stats, color), {
          direction: "top",
          opacity: 1,
          sticky: false,
          interactive: false,
          className: "map-hover-tooltip",
        });
        marker.on("click", () => {
          marker.closeTooltip();
          openBar(bar.id);
        });
        mapMarkers.push(marker);
        bounds.push([bar.lat, bar.lon]);
      });
      const search = searchQuery.trim();
      const fitKey = `${rankingFilter}|${amenityFilter}|${search.toLowerCase()}`;
      requestAnimationFrame(() => {
        if (!map) return;
        map.invalidateSize();
        if (fitKey === mapFitKey) return;
        if (search && bounds.length) {
          map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
        } else {
          map.setView(MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM);
        }
        mapFitKey = fitKey;
      });
      if (resultsSummary) {
        resultsSummary.textContent =
          rankingFilter === "rated"
            ? `${filtered.length} vurderte barer på kartet. Hold over en pin for bilde og score.`
            : `${filtered.length} barer uten score på kartet. Hold over en pin for bilde.`;
      }
    };

    requestAnimationFrame(() => requestAnimationFrame(draw));
  }

  function render() {
    updateStats();
    updateRankTabs();
    if (viewMode === "map") {
      renderMap();
      return;
    }
    if (listWrapper) listWrapper.hidden = false;
    if (mapPanel) mapPanel.hidden = true;
    renderList();
  }

  function histogramHtml(histogram, count) {
    if (!histogram || !count) {
      return `<p class="dialog-empty">Ingen folkestemmer ennå. Vær først ut.</p>`;
    }
    const max = Math.max(...histogram, 1);
    return `<div class="histogram-wrap">
      <p class="histogram-label">Fordeling av stemmer</p>
      <ol class="histogram">${histogram
        .map((value, index) => {
          const height = Math.max(8, Math.round((value / max) * 72));
          return `<li>
          <span class="histogram-bar" style="height:${height}px;background:${ratingColor(index + 1)}"></span>
          <span>${index + 1}</span>
        </li>`;
        })
        .join("")}</ol>
    </div>`;
  }

  function voteCount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function sortComments(list) {
    const items = Array.isArray(list) ? list.slice() : [];
    items.sort((a, b) => {
      if (commentSort === "newest") {
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      }
      return (
        voteCount(b.upvotes) - voteCount(a.upvotes) ||
        voteCount(a.downvotes) - voteCount(b.downvotes) ||
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
      );
    });
    return items;
  }

  function commentNet(item) {
    return voteCount(item.upvotes) - voteCount(item.downvotes);
  }

  function commentItemHtml(item) {
    const up = voteCount(item.upvotes);
    const down = voteCount(item.downvotes);
    const upActive = voteCount(item.myVote) === 1 ? " is-active" : "";
    const downActive = voteCount(item.myVote) === -1 ? " is-active" : "";
    const own = Boolean(item.own);
    const color = ratingColor(item.score);
    return `<li>
          <span class="comment-score" style="--score-color:${color};--overlay-glow:${color}" aria-label="${item.score} av 10">
            <span class="comment-score-number">${item.score}</span>
            <span class="comment-score-label">/10</span>
          </span>
          <p class="comment-text">${escapeHtml(item.comment)}</p>
          <div class="comment-votes">
            <button type="button" class="comment-vote comment-vote--up${upActive}" data-comment-id="${escapeHtml(item.id)}" data-vote="1" aria-pressed="${upActive ? "true" : "false"}" aria-label="Like, ${up}" ${own ? "disabled title=\"Du kan ikke like din egen kommentar\"" : ""}>↑ <span class="comment-vote-count">${up}</span></button>
            <button type="button" class="comment-vote comment-vote--down${downActive}" data-comment-id="${escapeHtml(item.id)}" data-vote="-1" aria-pressed="${downActive ? "true" : "false"}" aria-label="Dislike, ${down}" ${own ? "disabled title=\"Du kan ikke dislike din egen kommentar\"" : ""}>↓ <span class="comment-vote-count">${down}</span></button>
            ${own ? `<p class="comment-own">Din kommentar</p>` : ""}
          </div>
        </li>`;
  }

  function commentsHtml(comments) {
    const list = sortComments(comments);
    if (!list.length) {
      return `<p class="dialog-empty">Ingen kommentarer ennå. Du kan legge igjen en sammen med stemmen.</p>`;
    }
    const visible = list.filter((item) => commentNet(item) >= 0);
    const hidden = list.filter((item) => commentNet(item) <= -1);
    const visibleBlock = visible.length
      ? `<ul class="comment-list">${visible.map(commentItemHtml).join("")}</ul>`
      : `<p class="dialog-empty">Ingen synlige kommentarer. Nedstemte ligger skjult under.</p>`;
    const hiddenLabel =
      hidden.length === 1 ? "1 skjult kommentar" : `${hidden.length} skjulte kommentarer`;
    const hiddenBlock = hidden.length
      ? `<details class="hidden-comments"${hiddenCommentsOpen ? " open" : ""}>
          <summary>${hiddenLabel} (−1 eller lavere)</summary>
          <p class="hidden-comments-note">Nedstemt som støtende eller feil. Åpne for å se eller like dem tilbake.</p>
          <ul class="comment-list comment-list--hidden">${hidden.map(commentItemHtml).join("")}</ul>
        </details>`
      : "";
    return `${visibleBlock}${hiddenBlock}`;
  }

  function openBar(barId, { reopen = true } = {}) {
    const bar = bars.find((item) => item.id === barId);
    if (!bar || !barDialog || !dialogBody) return;
    if (reopen) hiddenCommentsOpen = false;
    selectedMapBarId = barId;
    document.querySelectorAll(".map-pin").forEach((el) => {
      el.classList.toggle("is-selected", el.getAttribute("data-bar-id") === barId);
    });
    const stats = displayScore(bar);
    const mine = myVote(bar.id);
    const website = bar.website ? safeUrl(bar.website) : null;
    const osmHref =
      bar.osmType && bar.osmId
        ? `https://www.openstreetmap.org/${encodeURIComponent(bar.osmType)}/${encodeURIComponent(String(bar.osmId))}`
        : null;
    const osmNote =
      bar.osmName && bar.osmName !== bar.title ? ` · OSM: ${escapeHtml(bar.osmName)}` : "";
    const scoreColor =
      stats.average == null ? "inherit" : ratingColor(stats.average);
    dialogBody.innerHTML = `
      <div class="dialog-media"></div>
      <div class="dialog-copy">
        <p class="eyebrow">${escapeHtml(amenityLabel(bar.amenity))}${osmNote}</p>
        <h2>${escapeHtml(bar.title)}</h2>
        <p class="dialog-score">
          <span class="dialog-score-value" style="color:${scoreColor}">${formatAverage(stats.average)}</span>
          /10
          <small>${stats.count} ${stats.count === 1 ? "stemme" : "stemmer"}</small>
        </p>
        ${bar.description ? `<p class="bar-description">${escapeHtml(bar.description)}</p>` : ""}
        <p class="dialog-links">
          ${website ? `<a href="${escapeHtml(website)}" rel="noopener noreferrer" target="_blank">Nettside</a>` : ""}
          ${osmHref ? `<a href="${escapeHtml(osmHref)}" rel="noopener noreferrer" target="_blank">OpenStreetMap</a>` : ""}
        </p>
        ${histogramHtml(stats.histogram, stats.count)}
        <fieldset class="rate-scale">
          <legend>${mine ? `Du ga ${mine.score}/10 — endre stemmen eller kommentaren` : "Gi en score (1 = friskt, 10 = piss)"}</legend>
          <div class="rate-buttons"></div>
          <label class="comment-field">
            <span>Valgfri kommentar</span>
            <textarea id="rateComment" maxlength="${COMMENT_MAX}" rows="3" placeholder="F.eks. Kjellerlukt ved doene.">${escapeHtml(mine?.comment || "")}</textarea>
            <small id="commentCount">0/${COMMENT_MAX}</small>
          </label>
          <button type="button" class="btn-ghost" id="saveRating">${mine ? "Oppdater stemme" : "Lagre stemme"}</button>
        </fieldset>
        <p class="rate-status" id="rateStatus"></p>
        <section class="comment-section" aria-label="Kommentarer">
          <h3>Kommentarer</h3>
          <div class="comment-sort" role="group" aria-label="Sorter kommentarer">
            <button type="button" class="comment-sort-btn${commentSort === "upvotes" ? " is-active" : ""}" data-comment-sort="upvotes">Flest likes</button>
            <button type="button" class="comment-sort-btn${commentSort === "newest" ? " is-active" : ""}" data-comment-sort="newest">Nyeste</button>
          </div>
          ${commentsHtml(stats.comments)}
        </section>
      </div>
    `;
    const media = dialogBody.querySelector(".dialog-media");
    media.appendChild(createMedia(bar, stats));
    const buttons = dialogBody.querySelector(".rate-buttons");
    SCALE_LABELS.forEach((label, index) => {
      const score = index + 1;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rate-btn";
      if (mine && mine.score === score) btn.classList.add("is-selected");
      btn.style.setProperty("--score-color", ratingColor(score));
      btn.innerHTML = `<span>${score}</span><small>${label}</small>`;
      btn.addEventListener("click", () => {
        buttons.querySelectorAll(".rate-btn").forEach((el) => el.classList.toggle("is-selected", el === btn));
        void submitRating(bar, score);
      });
      buttons.appendChild(btn);
    });
    const commentBox = document.getElementById("rateComment");
    const commentCount = document.getElementById("commentCount");
    const syncCount = () => {
      if (commentCount && commentBox) {
        commentCount.textContent = `${commentBox.value.length}/${COMMENT_MAX}`;
      }
    };
    syncCount();
    if (commentBox) commentBox.addEventListener("input", syncCount);
    const saveBtn = document.getElementById("saveRating");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const selected = dialogBody.querySelector(".rate-btn.is-selected");
        const selectedScore = selected
          ? Number(selected.querySelector("span")?.textContent)
          : mine?.score;
        if (!Number.isInteger(selectedScore)) {
          const status = document.getElementById("rateStatus");
          if (status) status.textContent = "Velg en score først.";
          return;
        }
        void submitRating(bar, selectedScore);
      });
    }
    bindCommentVotes(bar);
    dialogBody?.querySelector(".hidden-comments")?.addEventListener("toggle", (event) => {
      hiddenCommentsOpen = Boolean(event.currentTarget.open);
    });
    dialogBody?.querySelectorAll("[data-comment-sort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        commentSort = btn.getAttribute("data-comment-sort") === "newest" ? "newest" : "upvotes";
        openBar(bar.id, { reopen: false });
      });
    });
    if (reopen && !barDialog.open) {
      if (typeof barDialog.showModal === "function") barDialog.showModal();
      else if (typeof barDialog.show === "function") barDialog.show();
      else barDialog.setAttribute("open", "");
    }
    if (dialogScrim) {
      dialogScrim.hidden = barDialog.matches(":modal") || !barDialog.open;
    }
  }

  function bindCommentVotes(bar) {
    dialogBody?.querySelectorAll(".comment-vote").forEach((btn) => {
      btn.addEventListener("click", () => {
        void voteOnComment(bar, btn.getAttribute("data-comment-id"), Number(btn.getAttribute("data-vote")));
      });
    });
  }

  function applyCommentVoteLocally(barId, commentId, vote) {
    const stats = ratings[barId];
    if (!stats || !Array.isArray(stats.comments)) return false;
    const item = stats.comments.find((row) => row.id === commentId);
    if (!item || item.own) return false;
    const prev = voteCount(item.myVote);
    const next = prev === vote ? 0 : vote;
    item.upvotes = Math.max(0, voteCount(item.upvotes) - (prev === 1 ? 1 : 0) + (next === 1 ? 1 : 0));
    item.downvotes = Math.max(
      0,
      voteCount(item.downvotes) - (prev === -1 ? 1 : 0) + (next === -1 ? 1 : 0)
    );
    item.myVote = next;
    stats.comments = sortComments(stats.comments);
    return true;
  }

  async function voteOnComment(bar, commentId, vote) {
    if (commentVoteBusy || !commentId) return;
    commentVoteBusy = true;
    const previous = ratings[bar.id] ? JSON.parse(JSON.stringify(ratings[bar.id])) : null;
    applyCommentVoteLocally(bar.id, commentId, vote);
    openBar(bar.id, { reopen: false });
    dialogBody?.querySelectorAll(".comment-vote").forEach((btn) => {
      btn.disabled = true;
    });
    try {
      const response = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barId: bar.id,
          commentId,
          visitorId: visitorId(),
          vote,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Kunne ikke lagre stemmen.");
      ratings = payload.ratings || ratings;
      if (payload.stats) ratings[bar.id] = payload.stats;
      persistence = payload.persistence || persistence;
      openBar(bar.id, { reopen: false });
      render();
    } catch (err) {
      if (previous) ratings[bar.id] = previous;
      openBar(bar.id, { reopen: false });
      const nextStatus = document.getElementById("rateStatus");
      if (nextStatus) nextStatus.textContent = err.message || "Noe gikk galt.";
    } finally {
      commentVoteBusy = false;
    }
  }

  async function submitRating(bar, score) {
    const status = document.getElementById("rateStatus");
    const commentBox = document.getElementById("rateComment");
    const comment = commentBox ? commentBox.value : myVote(bar.id)?.comment || "";
    const buttons = dialogBody?.querySelectorAll(".rate-btn") || [];
    const saveBtn = document.getElementById("saveRating");
    buttons.forEach((btn) => {
      btn.disabled = true;
    });
    if (saveBtn) saveBtn.disabled = true;
    if (status) status.textContent = "Sender stemme…";
    try {
      const response = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barId: bar.id,
          score,
          visitorId: visitorId(),
          comment,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Kunne ikke lagre stemmen.");
      ratings = payload.ratings || ratings;
      if (payload.stats) ratings[bar.id] = payload.stats;
      persistence = payload.persistence || persistence;
      saveMyRating(bar.id, score, comment);
      updatePersistenceNote();
      openBar(bar.id, { reopen: false });
      render();
      const nextStatus = document.getElementById("rateStatus");
      if (nextStatus) {
        nextStatus.textContent = comment.trim()
          ? `Lagret: ${score}/10 — ${SCALE_LABELS[score - 1]}. Kommentaren er oppdatert.`
          : `Lagret: ${score}/10 — ${SCALE_LABELS[score - 1]}.`;
      }
    } catch (err) {
      if (status) status.textContent = err.message || "Noe gikk galt.";
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function updatePersistenceNote() {
    if (!persistenceNote) return;
    if (persistence === "turso") {
      persistenceNote.hidden = true;
      return;
    }
    if (persistence === "ephemeral") {
      persistenceNote.hidden = false;
      persistenceNote.textContent =
        "API-et kjører uten Turso ennå, så stemmer overlever ikke en restart. Sett TURSO_DATABASE_URL for ekte persistens.";
      return;
    }
    if (persistence === "file") {
      persistenceNote.hidden = false;
      persistenceNote.textContent =
        "Lokal modus: stemmer lagres i data/ratings.json. Koble på Turso i produksjon så de aldri går idle.";
    }
  }

  const MOBILE_FILTERS_MQ = "(max-width: 760px) and (pointer: coarse)";

  function isMobileFilters() {
    return window.matchMedia(MOBILE_FILTERS_MQ).matches;
  }

  function setFiltersOpen(open) {
    const next = Boolean(open) && isMobileFilters();
    document.body.classList.toggle("filters-open", next);
    filtersToggle?.setAttribute("aria-expanded", String(next));
    filtersToggle?.setAttribute("aria-label", next ? "Lukk søk og filter" : "Vis søk og filter");
    if (filtersScrim) filtersScrim.hidden = !next;
    if (filtersDrawer) {
      if (isMobileFilters()) filtersDrawer.toggleAttribute("inert", !next);
      else filtersDrawer.removeAttribute("inert");
    }
    if (next) {
      (filtersClose || searchInput)?.focus();
    } else if (document.activeElement && filtersDrawer?.contains(document.activeElement)) {
      filtersToggle?.focus();
    }
  }

  function setViewMode(mode) {
    viewMode = mode;
    if (viewGridBtn && viewListBtn && viewMapBtn) {
      viewGridBtn.classList.toggle("btn-toggle--active", mode === "grid");
      viewListBtn.classList.toggle("btn-toggle--active", mode === "list");
      viewMapBtn.classList.toggle("btn-toggle--active", mode === "map");
    }
    setFiltersOpen(false);
    render();
  }

  function pickRandomBar() {
    const pool = bars.filter((bar) => roundedAverage(bar) != null);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startGame() {
    currentGameBar = pickRandomBar();
    gameAttempts = 0;
    if (!currentGameBar) {
      if (gameSummary) gameSummary.textContent = "Ingen barer med score å gjette på ennå.";
      return;
    }
    if (gameTitle) gameTitle.textContent = currentGameBar.title;
    if (gameHint) {
      gameHint.textContent = "Gjett folkets snitt på Hectorskalaen (1–10).";
    }
    if (gameSummary) gameSummary.textContent = "Velg et tall mellom 1 og 10.";
    if (gameImage) {
      gameImage.style.backgroundImage = currentGameBar.picture
        ? `url(${currentGameBar.picture})`
        : "none";
      gameImage.textContent = currentGameBar.picture ? "" : initial(currentGameBar.title);
      gameImage.setAttribute("aria-label", `Bilde av ${currentGameBar.title}`);
    }
    if (guessInput) {
      guessInput.value = "";
      guessInput.disabled = false;
      guessInput.focus();
    }
    if (guessSubmit) {
      guessSubmit.disabled = false;
      guessSubmit.textContent = "Gjett";
    }
    if (guessFeedback) guessFeedback.textContent = "";
  }

  function handleGuess() {
    if (!currentGameBar || !guessInput) return;
    const value = Number(guessInput.value);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      if (gameSummary) gameSummary.textContent = "Velg et heltall mellom 1 og 10.";
      return;
    }
    gameAttempts += 1;
    const actual = roundedAverage(currentGameBar);
    const stats = displayScore(currentGameBar);
    if (value === actual) {
      if (gameSummary) {
        gameSummary.textContent = `Riktig! Folket ligger på ${formatAverage(stats.average)}/10. Forsøk: ${gameAttempts}.`;
      }
      if (guessFeedback) {
        guessFeedback.textContent = "Trykk Neste for en ny runde.";
      }
      if (guessSubmit) guessSubmit.textContent = "Neste";
      currentGameBar = null;
      return;
    }
    const direction = value < actual ? "høyere" : "lavere";
    if (gameSummary) {
      gameSummary.textContent = `Nei — prøv ${direction}. Forsøk: ${gameAttempts}.`;
    }
    if (guessFeedback) {
      guessFeedback.textContent = `Hint: baren lukter ${direction} på skalaen enn gjettet ditt.`;
    }
  }

  function initGameEvents() {
    if (!guessSubmit) return;
    guessSubmit.addEventListener("click", () => {
      if (!currentGameBar) {
        startGame();
        return;
      }
      handleGuess();
    });
    if (guessInput) {
      guessInput.addEventListener("keyup", (event) => {
        if (event.key !== "Enter") return;
        if (!currentGameBar) startGame();
        else handleGuess();
      });
    }
  }

  function initBrowseEvents() {
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value;
        render();
      });
    }
    if (amenityFilterEl) {
      amenityFilterEl.addEventListener("change", () => {
        amenityFilter = amenityFilterEl.value;
        render();
      });
    }
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        sortMode = sortSelect.value;
        if (sortMode === "near" && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
              render();
            },
            () => render(),
            { enableHighAccuracy: false, timeout: 8000 }
          );
        } else {
          render();
        }
      });
    }
    if (viewGridBtn) viewGridBtn.addEventListener("click", () => setViewMode("grid"));
    if (viewListBtn) viewListBtn.addEventListener("click", () => setViewMode("list"));
    if (viewMapBtn) viewMapBtn.addEventListener("click", () => setViewMode("map"));
    filtersToggle?.addEventListener("click", () => {
      setFiltersOpen(!document.body.classList.contains("filters-open"));
    });
    filtersClose?.addEventListener("click", () => setFiltersOpen(false));
    filtersScrim?.addEventListener("click", () => setFiltersOpen(false));
    window.matchMedia(MOBILE_FILTERS_MQ).addEventListener("change", () => {
      setFiltersOpen(false);
    });
    setFiltersOpen(false);
    document.querySelector(".header-home")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (barDialog?.open) barDialog.close();
      setFiltersOpen(false);
      searchQuery = "";
      if (searchInput) searchInput.value = "";
      rankingFilter = "rated";
      amenityFilter = "all";
      sortMode = "worst";
      if (amenityFilterEl) amenityFilterEl.value = "all";
      if (sortSelect) sortSelect.value = "worst";
      setViewMode("map");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    if (tabRated) {
      tabRated.addEventListener("click", () => {
        rankingFilter = "rated";
        render();
      });
    }
    if (tabUnrated) {
      tabUnrated.addEventListener("click", () => {
        rankingFilter = "unrated";
        render();
      });
    }
    if (dialogScrim) {
      dialogScrim.addEventListener("click", () => barDialog?.close());
    }
    if (barDialog) {
      barDialog.addEventListener("click", (event) => {
        if (event.target === barDialog) barDialog.close();
      });
      barDialog.addEventListener("close", () => {
        if (dialogScrim) dialogScrim.hidden = true;
        selectedMapBarId = null;
        document.querySelectorAll(".map-pin.is-selected").forEach((el) => {
          el.classList.remove("is-selected");
        });
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (document.body.classList.contains("filters-open")) {
          event.preventDefault();
          setFiltersOpen(false);
          return;
        }
        if (barDialog.open) barDialog.close();
      });
    }
  }

  async function loadBarsFromJson() {
    const response = await fetch("bars.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Kunne ikke hente bars.json");
    const json = await response.json();
    const list = Array.isArray(json) ? json : json.bars;
    if (!Array.isArray(list)) return;
    bars = list
      .filter((item) => item && typeof item.title === "string" && item.id)
      .map((item) => ({
        id: item.id,
        title: item.title,
        osmName: item.osmName || null,
        amenity: item.amenity || "bar",
        lat: typeof item.lat === "number" ? item.lat : null,
        lon: typeof item.lon === "number" ? item.lon : null,
        osmType: item.osmType || null,
        osmId: item.osmId || null,
        website: item.website || null,
        picture: item.picture || null,
        description: item.description || null,
        seedRating: typeof item.seedRating === "number" ? item.seedRating : null,
        curated: Boolean(item.curated),
      }));
  }

  async function loadRatings() {
    try {
      const response = await fetch(`/api/ratings?visitorId=${encodeURIComponent(visitorId())}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const json = await response.json();
      ratings = json.ratings || {};
      persistence = json.persistence || persistence;
      updatePersistenceNote();
    } catch {
      ratings = {};
    }
  }

  function openAboutDialog() {
    if (!aboutDialog) return;
    if (typeof setFiltersOpen === "function") setFiltersOpen(false);
    if (typeof aboutDialog.showModal === "function") aboutDialog.showModal();
    else aboutDialog.setAttribute("open", "");
  }

  function initAboutDialog() {
    if (!aboutToggle || !aboutDialog) return;
    aboutToggle.addEventListener("click", openAboutDialog);
    aboutDialog.addEventListener("click", (event) => {
      if (event.target === aboutDialog) aboutDialog.close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && aboutDialog.open) {
        event.preventDefault();
        aboutDialog.close();
      }
    });
  }

  async function init() {
    visitorId();
    initAboutDialog();
    await loadBarsFromJson();
    await loadRatings();
    if (isGamePage) {
      initGameEvents();
      startGame();
      return;
    }
    initBrowseEvents();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void init();
    });
  } else {
    void init();
  }
})();
