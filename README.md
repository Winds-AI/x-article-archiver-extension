# X Article Archiver Extension

Personal Chrome extension for extracting the currently open X/Twitter post or long-form article into a static HTML archive hosted on Cloudflare Pages.

## Current behavior

- Runs on `x.com` / `twitter.com` in your logged-in browser.
- Extracts the opened post or X Article from the DOM.
- Preserves article order and structure: headings, paragraphs, lists, links, inline emphasis, and media images.
- Uploads a full tiny static archive site to Cloudflare Pages.
- Copies the stable article URL after upload.

## URL shape

```text
https://<project>.pages.dev/article/<slug>/
```

The extension also keeps an archive index at:

```text
https://<project>.pages.dev/
```

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select:

```text
/home/meet/Tinkering/x-article-archiver-extension
```

## Cloudflare settings

Open the extension popup, expand **Cloudflare**, and save:

- Account ID
- Pages project name
- API token with Cloudflare Pages edit permission
- Base URL, for example `https://<project>.pages.dev`

## Test flow

1. Open an X post or X Article while logged in.
2. Click the extension icon.
3. Click **Archive + upload**.
4. The extension extracts, rebuilds the archive site, deploys it to Cloudflare Pages, and copies the final URL.

## Files

```text
manifest.json
src/background.js             # image fetching / data URL conversion
src/content.js                # X DOM structural extraction
src/popup.html                # extension popup
src/popup.css
src/popup.js                  # rendering, local archive history, Cloudflare Pages upload
```
