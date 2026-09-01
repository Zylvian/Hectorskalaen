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

  /** @type {Array<any>} */
  let bars = [];
  /** @type {Record<string, {average: number|null, count: number, histogram: number[], comments?: Array<{score:number, comment:string}>}>} */
  let ratings = {};
  let searchQuery = "";
  let sortMode = "worst";
  let viewMode = "grid";
  let amenityFilter = "all";
  let rankingFilter = "rated";
  let userLocation = null;
  let map = null;
  let mapMarkers = [];
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
  const mapPanel = document.getElementById("mapPanel");
  const listWrapper = document.querySelector(".bars-scroll-wrapper");
  const barDialog = document.getElementById("barDialog");
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

  function displayScore(bar) {
    const live = ratings[bar.id];
    if (live && live.count > 0 && typeof live.average === "number") {
      return { ...live, comments: live.comments || [] };
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
    if (value == null) return "–";
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
    const worstLabel = document.getElementById("statWorstLabel");
    if (worstLabel) worstLabel.textContent = worst ? worst.title : "Verst nå";
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
        map = L.map(el, { scrollWheelZoom: true }).setView([60.392, 5.324], 14);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
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
        const marker = L.circleMarker([bar.lat, bar.lon], {
          radius: 9,
          color: "#07080d",
          weight: 1,
          fillColor: color,
          fillOpacity: 0.95,
        }).addTo(map);
        marker.bindTooltip(`${bar.title} · ${formatAverage(stats.average)}/10`, {
          direction: "top",
        });
        marker.on("click", () => openBar(bar.id));
        mapMarkers.push(marker);
        bounds.push([bar.lat, bar.lon]);
      });
      if (bounds.length) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
      }
      if (resultsSummary) {
        resultsSummary.textContent =
          rankingFilter === "rated"
            ? `${filtered.length} vurderte barer på kartet.`
            : `${filtered.length} barer uten score på kartet.`;
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
    return `<ol class="histogram">${histogram
      .map((value, index) => {
        const height = Math.max(8, Math.round((value / max) * 72));
        return `<li>
          <span class="histogram-bar" style="height:${height}px;background:${ratingColor(index + 1)}"></span>
          <span>${index + 1}</span>
        </li>`;
      })
      .join("")}</ol>`;
  }

  function commentsHtml(comments) {
    const list = Array.isArray(comments) ? comments : [];
    if (!list.length) {
      return `<p class="dialog-empty">Ingen kommentarer ennå. Du kan legge igjen en sammen med stemmen.</p>`;
    }
    return `<ul class="comment-list">${list
      .map(
        (item) => `<li>
          <span class="comment-score" style="color:${ratingColor(item.score)}">${item.score}/10</span>
          <p>${escapeHtml(item.comment)}</p>
        </li>`
      )
      .join("")}</ul>`;
  }

  function openBar(barId, { reopen = true } = {}) {
    const bar = bars.find((item) => item.id === barId);
    if (!bar || !barDialog || !dialogBody) return;
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
    if (reopen && typeof barDialog.showModal === "function" && !barDialog.open) {
      barDialog.showModal();
    } else if (reopen && !barDialog.open) {
      barDialog.setAttribute("open", "");
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

  function setViewMode(mode) {
    viewMode = mode;
    if (viewGridBtn && viewListBtn && viewMapBtn) {
      viewGridBtn.classList.toggle("btn-toggle--active", mode === "grid");
      viewListBtn.classList.toggle("btn-toggle--active", mode === "list");
      viewMapBtn.classList.toggle("btn-toggle--active", mode === "map");
    }
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
    if (barDialog) {
      barDialog.addEventListener("click", (event) => {
        if (event.target === barDialog) barDialog.close();
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
      const response = await fetch("/api/ratings", { cache: "no-store" });
      if (!response.ok) return;
      const json = await response.json();
      ratings = json.ratings || {};
      persistence = json.persistence || persistence;
      updatePersistenceNote();
    } catch {
      ratings = {};
    }
  }

  async function init() {
    visitorId();
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
