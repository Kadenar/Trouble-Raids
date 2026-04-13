# GW2 Raid Static

Static read-only overview for the raid sheet.

It fetches sheet data from Apps Script first, falls back to parsing published HTML if needed, then renders the result in the browser.

## High-Level Flow

1. `src/app/OverviewPage.tsx` loads the overview snapshot on page load.
2. `src/lib/overviewAppsScript.ts` fetches the Apps Script endpoint and normalizes JSON into the shared snapshot shape.
3. `src/lib/overviewHtml.ts` parses raw Google Sheets HTML when the response is not JSON.
4. `src/lib/overviewView.ts` holds shared display logic, normalization helpers, theming, and row filtering.
5. `src/app/OverviewPage.tsx` renders the table, applies sticky behavior, and writes the snapshot to local cache.
6. `src/lib/googleSheets.ts` stores the cached snapshot in `localStorage`.

## Modules

### `src/app/OverviewPage.tsx`

Main page component.

Responsibilities:
- loads the current overview snapshot
- chooses which source path was used
- renders the table
- applies sticky row and column behavior
- applies wing theming
- exposes refresh and cache controls

### `src/lib/overviewAppsScript.ts`

Apps Script source loader.

Responsibilities:
- fetches the Apps Script web app response
- converts JSON payloads into the shared snapshot shape
- preserves row/column dimensions, merged ranges, alignment, and bold state
- filters CMS rows
- falls back to HTML parsing if the response is not JSON

### `src/lib/overviewHtml.ts`

HTML fallback parser.

Responsibilities:
- parses raw Google Sheets HTML
- extracts cell text, links, spans, styles, row heights, and column count
- filters CMS rows
- rebuilds the row matrix after filtering
- returns the same shared snapshot shape used by the Apps Script path

### `src/lib/overviewView.ts`

Shared view/model helpers.

Responsibilities:
- defines shared overview types and constants
- normalizes text, colors, and alignment values
- detects wing headers and divider columns
- computes wing theming
- builds basic cell CSS
- computes sticky row offsets
- rebuilds rows after filtering while preserving merged cells

### `src/lib/googleSheets.ts`

Local cache helper.

Responsibilities:
- defines the local cache key
- reads the cached snapshot from `localStorage`
- writes the cached snapshot to `localStorage`
- clears the cached snapshot

## Data Shape

The app works with a shared snapshot model:

- `title`
- `fetchedAt`
- `rows`
- `rowHeights`
- `columnWidths`

Each cell can include:

- `text`
- `href`
- `rowSpan`
- `colSpan`
- `bold`
- `style`

## Rendering Behavior

The overview renderer applies a few layers of polish on top of the raw sheet data:

- wing rows drive row theme colors for the sections below them
- `Sub 2` is used as a visual divider
- Challenge Mode rows are removed before render
- special instruction cells can overflow across empty cells
- the top rows and first columns are sticky
- the parsed or API-provided dimensions are used where available

## Source Priority

The loader uses this order:

1. Apps Script JSON
2. HTML fallback

The UI displays which path was used.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run preview`

## GitHub Pages

The repo includes a GitHub Actions workflow at [\.github/workflows/deploy-pages.yml](./.github/workflows/deploy-pages.yml).

It builds on pushes to `main` and deploys the `dist` folder to GitHub Pages.

The Vite base path is read from `VITE_BASE_PATH` during the Pages build, so the generated asset URLs match the repository subpath.

## Notes

- The app is intentionally read-only.
- All persistence is browser-side cache only.
