# Hectorskalaen – Bar Smell Index (Bergen)

Hectorskalaen is a small web app that lists how strongly bars in Bergen, Norway smell on a scale from **1–10**.

The main view shows the full bar list (from `bars.json`) and lets you:
- Search by bar name
- Sort by smell rating (high → low or low → high)
- Toggle between grid and list views
- Quickly scan the bar rating (with a color-coded, glowing overlay)

There is also a separate **game mode** where you guess the rating of a randomly chosen bar.

---

## Running the app

1. Open the project folder:
   - `c:\CODE\NEW CODE FOLDER\Cursor\Hectorskalaen`
2. Open `src/index.html` in a browser (double‑click it or drag it into a browser window).

No build tools, npm, or backend are required.

👉 To play the game, open `src/game.html` in your browser.

---

## How to add or edit bars

Bars are defined in `src/bars.json` as an array of objects:

```json
{
  "title": "Bar name",
  "rating": 1,
  "picture": "https://example.com/image.jpg",
  "description": "Optional description"
}
```

To add a new bar, simply add another object to the array and reload the page.

---

## Folder structure

- `src/index.html` — main browse/list UI
- `src/game.html` — standalone guessing game
- `src/app.js` — shared UI logic (list + game)
- `src/styles.css` — shared styling for both pages
- `src/bars.json` — bar data (title, rating, picture, description)

---

## Design goals

- Easy to browse + search bars
- Fast scrolling and responsive layout
- Simple to update the bar list via `bars.json`
- Lightweight: vanilla HTML/JS/CSS, no build step

