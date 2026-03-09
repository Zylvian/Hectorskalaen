(() => {
  /**
   * @typedef {Object} Bar
   * @property {string} title
   * @property {number} rating
   * @property {string | null} picture
   * @property {string | null} description
   */

  /** @type {Bar[]} */
  let bars = [];
  let searchQuery = "";
  let sortMode = "random"; // "random" | "desc" | "asc"
  let viewMode = "grid"; // "grid" | "list"
  let appMode = "browse"; // "browse" | "game"
  let currentGameBar = null;
  let gameAttempts = 0;

  const searchInput = document.getElementById("searchInput");
  const barsList = /** @type {HTMLUListElement | null} */ (
    document.getElementById("barsList")
  );
  const resultsSummary = document.getElementById("resultsSummary");
  const sortToggle = document.getElementById("sortToggle");
  const viewGridBtn = document.getElementById("viewGrid");
  const viewListBtn = document.getElementById("viewList");
  const tabBrowse = document.getElementById("tabBrowse");
  const tabGame = document.getElementById("tabGame");
  const browseControls = document.querySelector(".browse-controls");
  const backToBrowse = document.getElementById("backToBrowse");
  const gameSummary = document.getElementById("gameSummary");
  const gameImage = document.getElementById("gameImage");
  const gameTitle = document.getElementById("gameTitle");
  const gameHint = document.getElementById("gameHint");
  const guessInput = document.getElementById("guessInput");
  const guessSubmit = document.getElementById("guessSubmit");
  const guessFeedback = document.getElementById("guessFeedback");
  const panelList = document.querySelector(".panel-list");
  const panelGame = document.querySelector(".panel-game");

  function shuffleInPlace(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
  }

  function ratingLabel(rating) {
    if (rating >= 8) return "legendary";
    if (rating >= 6) return "strong";
    if (rating >= 4) return "noticeable";
    if (rating >= 2) return "mild";
    return "faint";
  }

  function ratingColor(rating) {
    // Map 1–10 to a green → yellow → red gradient (10 is most severe)
    const clamped = Math.min(10, Math.max(1, Math.round(rating)));
    const hue = 120 - ((clamped - 1) / 9) * 120;
    return `hsl(${hue.toFixed(0)}, 84%, 55%)`;
  }

  function setAppMode(mode) {
    appMode = mode;
    const browsing = mode === "browse";
    if (panelList) panelList.hidden = !browsing;
    if (panelGame) panelGame.hidden = browsing;

    if (tabBrowse && tabGame) {
      tabBrowse.classList.toggle("btn-toggle--active", browsing);
      tabBrowse.setAttribute("aria-selected", String(browsing));
      tabGame.classList.toggle("btn-toggle--active", !browsing);
      tabGame.setAttribute("aria-selected", String(!browsing));
    }

    if (browseControls) {
      browseControls.style.display = browsing ? "flex" : "none";
    }

    if (viewGridBtn && viewListBtn && sortToggle) {
      viewGridBtn.disabled = !browsing;
      viewListBtn.disabled = !browsing;
      sortToggle.disabled = !browsing;
    }

    if (!browsing) {
      startGame();
    }
  }

  function pickRandomBar() {
    if (!bars.length) return null;
    const idx = Math.floor(Math.random() * bars.length);
    return bars[idx];
  }

  function formatHint(bar) {
    return `Guess the rating for this bar (1–10).`;
  }

  function startGame() {
    currentGameBar = pickRandomBar();
    gameAttempts = 0;
    if (!currentGameBar) {
      if (gameSummary) gameSummary.textContent = "No bars available for the game yet.";
      return;
    }
    updateGameUI();
  }

  function updateGameUI(message) {
    if (!currentGameBar) return;

    if (gameTitle) gameTitle.textContent = currentGameBar.title;
    if (gameHint) gameHint.textContent = formatHint(currentGameBar);
    if (gameSummary) gameSummary.textContent = message || "Pick a number between 1 and 10.";

    if (gameImage) {
      gameImage.style.backgroundImage = currentGameBar.picture
        ? `url(${currentGameBar.picture})`
        : "none";
      gameImage.setAttribute(
        "aria-label",
        `Photo of ${currentGameBar.title}`
      );
    }

    if (guessInput) {
      guessInput.value = "";
      guessInput.disabled = false;
      guessInput.focus();
    }
    if (guessSubmit) {
      guessSubmit.disabled = false;
      guessSubmit.textContent = "Guess";
    }
    if (guessFeedback) guessFeedback.textContent = "";
  }

  function handleGuess() {
    if (!currentGameBar || !guessInput) return;
    const value = Number(guessInput.value);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      if (gameSummary) gameSummary.textContent = "Pick a whole number between 1 and 10.";
      return;
    }

    gameAttempts += 1;

    if (value === currentGameBar.rating) {
      if (gameSummary)
        gameSummary.textContent =
          `Correct! It’s ${currentGameBar.rating}/10. Attempts: ${gameAttempts}.`;
      if (guessFeedback)
        guessFeedback.textContent =
          "Nice! Press Next to play another round.";
      if (guessInput) guessInput.disabled = false;
      if (guessSubmit) guessSubmit.textContent = "Next";
      currentGameBar = null;
      return;
    }

    const direction = value < currentGameBar.rating ? "higher" : "lower";
    if (gameSummary)
      gameSummary.textContent = `Nope — try ${direction}. Attempts: ${gameAttempts}.`;
    if (guessFeedback)
      guessFeedback.textContent =
        `Hint: the bar smells ${direction} on the scale than your guess.`;
  }

  function initGameEvents() {
    if (tabBrowse) {
      tabBrowse.addEventListener("click", () => setAppMode("browse"));
    }

    if (tabGame) {
      tabGame.addEventListener("click", () => setAppMode("game"));
    }

    if (backToBrowse) {
      backToBrowse.addEventListener("click", () => {
        setAppMode("browse");
      });
    }

    if (guessSubmit) {
      guessSubmit.addEventListener("click", () => {
        if (!currentGameBar) {
          startGame();
          return;
        }
        handleGuess();
      });
    }

    if (guessInput) {
      guessInput.addEventListener("keyup", (event) => {
        if (event.key === "Enter") {
          if (!currentGameBar) {
            startGame();
            return;
          }
          handleGuess();
        }
      });
    }
  }

  function createBarElement(bar) {
    const li = document.createElement("li");
    li.className = "bar-card";

    const media = document.createElement("div");
    media.className = "bar-media";

    const image = document.createElement("img");
    image.className = "bar-image";
    if (bar.picture) {
      image.src = bar.picture;
      image.alt = bar.title;
    } else {
      image.alt = `Photo of ${bar.title}`;
    }

    const overlay = document.createElement("div");
    overlay.className = "bar-rating-overlay";

    const overlayNumber = document.createElement("span");
    overlayNumber.className = "bar-rating-overlay-number";
    overlayNumber.textContent = String(bar.rating);
    overlayNumber.style.color = ratingColor(bar.rating);

    // Sync glow with the rating color so it matches the number
    overlay.style.setProperty("--overlay-glow", ratingColor(bar.rating));

    const overlayLabel = document.createElement("span");
    overlayLabel.className = "bar-rating-overlay-label";
    overlayLabel.textContent = "/10";

    overlay.appendChild(overlayNumber);
    overlay.appendChild(overlayLabel);
    media.appendChild(image);
    media.appendChild(overlay);

    const info = document.createElement("div");
    info.className = "bar-info";

    const titleEl = document.createElement("h3");
    titleEl.className = "bar-title";
    titleEl.textContent = bar.title;

    info.appendChild(titleEl);

    if (bar.description && bar.description.trim().length > 0) {
      const desc = document.createElement("p");
      desc.className = "bar-description";
      desc.textContent = bar.description;
      info.appendChild(desc);
    }
    li.appendChild(media);
    li.appendChild(info);

    return li;
  }

  function render() {
    if (!barsList || !resultsSummary) return;

    barsList.classList.toggle("bars-list--grid", viewMode === "grid");

    const normalizedQuery = searchQuery.trim().toLowerCase();

    let filtered = bars;
    if (normalizedQuery) {
      filtered = bars.filter((bar) =>
        bar.title.toLowerCase().includes(normalizedQuery)
      );
    }

    filtered = [...filtered];
    if (sortMode === "desc" || sortMode === "asc") {
      filtered.sort((a, b) =>
        sortMode === "desc" ? b.rating - a.rating : a.rating - b.rating
      );
    }

    const total = bars.length;
    const visible = filtered.length;
    if (total === 0) {
      resultsSummary.textContent = "No bars yet in the Hectorskalaen guide.";
    } else if (normalizedQuery) {
      resultsSummary.textContent = `${visible} of ${total} bars match “${searchQuery.trim()}”.`;
    } else {
      resultsSummary.textContent = `${visible} bar${visible === 1 ? "" : "er"} er på Hectorskalaen.`;
    }

    barsList.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("li");
      empty.className = "bar-card";
      empty.textContent = "No bars match your search yet.";
      barsList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach((bar) => {
      const card = createBarElement(bar);
      card.classList.add(
        viewMode === "grid" ? "bar-card--grid" : "bar-card--list"
      );
      fragment.appendChild(card);
    });
    barsList.appendChild(fragment);
  }

  async function loadBarsFromJson() {
    try {
      const response = await fetch("bars.json", { cache: "no-cache" });
      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.warn("Failed to fetch bars.json", response.status);
        return;
      }
      const json = await response.json();
      if (!Array.isArray(json)) return;

      bars = json
        .filter(
          (item) =>
            item &&
            typeof item.title === "string" &&
            typeof item.rating === "number"
        )
        .map((item) => ({
          title: item.title,
          rating: item.rating,
          picture:
            typeof item.picture === "string" && item.picture.length > 0
              ? item.picture
              : null,
          description:
            typeof item.description === "string" &&
            item.description.trim().length > 0
              ? item.description.trim()
              : null,
        }));

      shuffleInPlace(bars);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Error loading bars from bars.json", err);
    }
  }

  function initEvents() {
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value;
        render();
      });
    }
    if (sortToggle) {
      sortToggle.addEventListener("click", () => {
        if (sortMode === "random" || sortMode === "asc") {
          sortMode = "desc";
          sortToggle.textContent = "Sort: smell high → low";
        } else {
          sortMode = "asc";
          sortToggle.textContent = "Sort: smell low → high";
        }
        render();
      });
    }

    if (viewGridBtn && viewListBtn) {
      const setViewMode = (mode) => {
        viewMode = mode;
        viewGridBtn.classList.toggle(
          "btn-toggle--active",
          mode === "grid"
        );
        viewListBtn.classList.toggle(
          "btn-toggle--active",
          mode === "list"
        );
        render();
      };

      viewGridBtn.addEventListener("click", () => setViewMode("grid"));
      viewListBtn.addEventListener("click", () => setViewMode("list"));
    }

    initGameEvents();
  }

  async function init() {
    await loadBarsFromJson();
    initEvents();
    render();

    const defaultMode = panelGame && !panelList ? "game" : "browse";
    setAppMode(defaultMode);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void init();
    });
  } else {
    void init();
  }
})();
