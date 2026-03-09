# Hectorskalaen – Bar Smell Index (Bergen)

Hectorskalaen is a small single-page web app for tracking how strongly different bars in Bergen, Norway smell on a scale from **1–10**.

Everything runs in the browser – data is stored in `localStorage`, so nothing is sent to a server.

## Running the page

1. Open the project folder:
   - `c:\CODE\NEW CODE FOLDER\Cursor\Hectorskalaen`
2. Open `index.html` in a browser (double‑click it, or drag it into a window).

No build tools, npm, or backend are required.

## Features

- **Add bars easily**
  - Enter a bar name.
  - Pick a smell rating (1–10) with a slider.
  - Optionally upload a picture (stored locally in your browser as a data URL).

- **Browse & search**
  - Sticky header with **search** so you can quickly filter by bar name.
  - Scrollable list with cards showing:
    - Bar name
    - Smell rating + label (e.g. “legendary”, “mild”)
    - Date/time added
    - Picture (if provided)

- **Sort & manage**
  - Toggle sort between “smell high → low” and “smell low → high”.
  - Remove individual bars.
  - Clear all bars for this browser.

## Data storage

Bars are stored JSON-encoded in `window.localStorage` under the key:

```text
hectorskalaen-bars-v1
```

If you want to “reset” everything manually, you can clear that key in your browser dev tools or use the **“Clear all (this browser)”** button in the UI.

