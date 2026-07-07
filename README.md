# X Article Archiver Extension

Personal Chrome extension for saving the current X/Twitter post or long-form article into a tiny Cloudflare Worker + R2 archive.

## What it does

- Extracts the current X post or X Article from your logged-in browser.
- Preserves headings, paragraphs, lists, links, inline emphasis, and article images.
- Builds one standalone HTML page for the article.
- Uploads that page to a Worker endpoint.
- Stores article HTML and metadata in one R2 bucket.
- Serves a simple index page at the archive site root.

## URL shape

```text
https://<worker-name>.<account-subdomain>.workers.dev/
https://<worker-name>.<account-subdomain>.workers.dev/article/<slug>/
```

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Cloudflare setup

Create one R2 bucket:

```text
x-article-archive
```

Deploy the Worker in this repo with an R2 binding named:

```text
ARCHIVE_BUCKET
```

Set one Worker secret:

```text
UPLOAD_SECRET
```

## Extension settings

Open the extension popup and save:

- Archive site URL, for example `https://x-article-archive.example.workers.dev`
- Upload secret, the same value as the Worker `UPLOAD_SECRET`

That same URL and secret can be used on any PC. Each upload adds one article to the same R2-backed archive.

## Test flow

1. Open an X post or X Article while logged in.
2. Click the extension icon.
3. Click **Archive**.
4. The extension uploads the article and copies the public article URL.
