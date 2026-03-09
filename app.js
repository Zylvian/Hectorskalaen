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
  let sortDescending = true;
  let viewMode = "grid"; // "grid" | "list"

  const searchInput = document.getElementById("searchInput");
  const barsList = /** @type {HTMLUListElement | null} */ (
    document.getElementById("barsList")
  );
  const resultsSummary = document.getElementById("resultsSummary");
  const sortToggle = document.getElementById("sortToggle");
  const viewGridBtn = document.getElementById("viewGrid");
  const viewListBtn = document.getElementById("viewList");

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

    const image = document.createElement("img");
    image.className = "bar-image";
    if (bar.picture) {
      image.src = bar.picture;
      image.alt = bar.title;
    } else {
      image.alt = `Photo of ${bar.title}`;
    }

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

    const meta = document.createElement("div");
    meta.className = "bar-meta";

    const ratingPill = document.createElement("span");
    ratingPill.className = "rating-pill";
    if (bar.rating >= 8) {
      ratingPill.classList.add("rating-pill-strong");
    } else if (bar.rating <= 3) {
      ratingPill.classList.add("rating-pill-mild");
    }

    const ratingNumber = document.createElement("span");
    ratingNumber.className = "bar-rating-number";
    ratingNumber.textContent = `${bar.rating}/10`;

    const ratingText = document.createElement("span");
    ratingText.className = "bar-rating-label";
    ratingText.textContent = ` ${ratingLabel(bar.rating)} smell`;

    ratingPill.appendChild(ratingNumber);
    ratingPill.appendChild(ratingText);
    meta.appendChild(ratingPill);

    info.appendChild(titleEl);
    info.appendChild(meta);

    li.appendChild(image);
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

    filtered = [...filtered].sort((a, b) => {
      const diff = a.rating - b.rating;
      return sortDescending ? -diff : diff;
    });

    const total = bars.length;
    const visible = filtered.length;
    if (total === 0) {
      resultsSummary.textContent = "No bars yet in the Hectorskalaen guide.";
    } else if (normalizedQuery) {
      resultsSummary.textContent = `${visible} of ${total} bars match “${searchQuery.trim()}”.`;
    } else {
      resultsSummary.textContent = `${visible} bar${visible === 1 ? "" : "s"} on the Hectorskalaen.`;
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
        sortDescending = !sortDescending;
        sortToggle.textContent = sortDescending
          ? "Sort: smell high → low"
          : "Sort: smell low → high";
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
