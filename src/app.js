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
  let viewMode = "list"; // "grid" | "list"

  const searchInput = document.getElementById("searchInput");
  const barsList = /** @type {HTMLUListElement | null} */ (
    document.getElementById("barsList")
  );
  const resultsSummary = document.getElementById("resultsSummary");
  const sortToggle = document.getElementById("sortToggle");
  const viewGridBtn = document.getElementById("viewGrid");
  const viewListBtn = document.getElementById("viewList");

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

    if (bar.description && bar.description.trim().length > 0) {
      const desc = document.createElement("p");
      desc.className = "bar-description";
      desc.textContent = bar.description;
      info.appendChild(desc);
    }

    info.appendChild(titleEl);
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
  }

  async function init() {
    await loadBarsFromJson();
    initEvents();
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
