const ARTICLE_PREFIX = 'articles/';
const META_PREFIX = 'meta/';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/') {
        return htmlResponse(await renderIndex(env.ARCHIVE_BUCKET));
      }

      if (request.method === 'GET' && url.pathname.startsWith('/article/')) {
        return serveArticle(url, env.ARCHIVE_BUCKET);
      }

      if (request.method === 'POST' && url.pathname === '/api/archive') {
        return handleUpload(request, env);
      }

      return textResponse('Not found', 404);
    } catch (error) {
      return jsonResponse({ ok: false, error: error?.message || String(error) }, 500);
    }
  }
};

async function handleUpload(request, env) {
  const expected = env.UPLOAD_SECRET;
  const actual = request.headers.get('Authorization') || '';
  if (!expected || actual !== `Bearer ${expected}`) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return jsonResponse({ ok: false, error: 'Expected JSON' }, 415);
  }

  const body = await request.json();
  const slug = cleanSlug(body.slug);
  const title = cleanText(body.title, 180) || 'Untitled';
  const sourceUrl = cleanText(body.sourceUrl, 1000);
  const publishedAt = cleanText(body.publishedAt, 80);
  const archivedAt = cleanText(body.archivedAt, 80) || new Date().toISOString();
  const html = String(body.html || '');

  if (!slug) return jsonResponse({ ok: false, error: 'Missing slug' }, 400);
  if (!sourceUrl) return jsonResponse({ ok: false, error: 'Missing source URL' }, 400);
  if (!html.includes('<!doctype html>') && !html.includes('<html')) {
    return jsonResponse({ ok: false, error: 'Missing article HTML' }, 400);
  }
  if (html.length > 8_000_000) {
    return jsonResponse({ ok: false, error: 'Article HTML is too large' }, 413);
  }

  const meta = { slug, title, sourceUrl, publishedAt, archivedAt };
  await env.ARCHIVE_BUCKET.put(`${ARTICLE_PREFIX}${slug}/index.html`, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' }
  });
  await env.ARCHIVE_BUCKET.put(`${META_PREFIX}${slug}.json`, JSON.stringify(meta, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });

  return jsonResponse({ ok: true, url: `${new URL(request.url).origin}/article/${slug}/`, meta });
}

async function serveArticle(url, bucket) {
  const slug = cleanSlug(url.pathname.split('/').filter(Boolean)[1] || '');
  if (!slug) return textResponse('Not found', 404);

  const object = await bucket.get(`${ARTICLE_PREFIX}${slug}/index.html`);
  if (!object) return textResponse('Not found', 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

async function renderIndex(bucket) {
  const entries = await listEntries(bucket);
  const items = entries.map((entry) => (
    `<li><a href="/article/${escapeHtml(entry.slug)}/">${escapeHtml(entry.title)}</a><span>${escapeHtml(formatDate(entry.archivedAt))}</span></li>`
  )).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Archive</title>
  <style>
    :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; }
    @media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#eee; --muted:#999; --line:#333; } }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width:min(760px, calc(100% - 32px)); margin:48px auto; }
    h1 { font-size:34px; margin:0 0 24px; }
    ul { list-style:none; padding:0; margin:0; border-top:1px solid var(--line); }
    li { display:flex; justify-content:space-between; gap:16px; padding:14px 0; border-bottom:1px solid var(--line); }
    a { color:inherit; font-weight:600; text-decoration:none; overflow-wrap:anywhere; }
    span { color:var(--muted); white-space:nowrap; }
    .empty { color:var(--muted); }
    @media (max-width:520px) { li { display:block; } span { display:block; margin-top:4px; } }
  </style>
</head>
<body><main><h1>Archive</h1>${items ? `<ul>${items}</ul>` : '<p class="empty">No articles yet.</p>'}</main></body>
</html>`;
}

async function listEntries(bucket) {
  const entries = [];
  let cursor;

  do {
    const listed = await bucket.list({ prefix: META_PREFIX, cursor });
    for (const object of listed.objects) {
      const metaObject = await bucket.get(object.key);
      if (!metaObject) continue;
      try {
        const meta = await metaObject.json();
        if (meta?.slug && meta?.title) entries.push(meta);
      } catch {}
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return entries.sort((a, b) => String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')));
}

function cleanSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function cleanText(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
