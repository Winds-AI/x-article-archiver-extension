import { blake3 } from './vendor/noble-hashes/blake3.js';

const MESSAGE_EXTRACT = 'X_ARCHIVER_EXTRACT';
const MESSAGE_FETCH_IMAGE = 'X_ARCHIVER_FETCH_IMAGE';
const API = 'https://api.cloudflare.com/client/v4';
const ARCHIVE_MANIFEST = 'archives.json';

const els = {
  archiveBtn: document.getElementById('archiveBtn'),
  downloadHtmlBtn: document.getElementById('downloadHtmlBtn'),
  embedImages: document.getElementById('embedImages'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  title: document.getElementById('title'),
  meta: document.getElementById('meta'),
  url: document.getElementById('url'),
  settings: document.getElementById('settings'),
  accountId: document.getElementById('accountId'),
  projectName: document.getElementById('projectName'),
  apiToken: document.getElementById('apiToken'),
  baseUrl: document.getElementById('baseUrl'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn')
};

let currentArchive = null;
let currentHtml = '';

function setStatus(message, tone = '') {
  els.status.textContent = message;
  els.status.className = tone;
}

function setBusy(isBusy) {
  els.archiveBtn.disabled = isBusy;
  els.archiveBtn.textContent = isBusy ? 'Workingâ¦' : 'Archive + upload';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sanitizeInlineHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

function slugify(value) {
  return String(value || 'archive')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'archive';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function withChromeCallback(invoke) {
  return new Promise((resolve, reject) => {
    invoke((result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

async function storageGet(defaults) {
  return withChromeCallback((done) => chrome.storage.local.get(defaults, done));
}

async function storageSet(values) {
  return withChromeCallback((done) => chrome.storage.local.set(values, done));
}

async function activeTab() {
  const [tab] = await withChromeCallback((done) => chrome.tabs.query({ active: true, currentWindow: true }, done));
  return tab;
}

function isXUrl(url) {
  try { return ['x.com', 'twitter.com', 'mobile.twitter.com'].includes(new URL(url).hostname); }
  catch { return false; }
}

async function extractFromTab(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
  return withChromeCallback((done) => chrome.tabs.sendMessage(tabId, { type: MESSAGE_EXTRACT }, done));
}

async function fetchImageDataUrl(url) {
  return withChromeCallback((done) => chrome.runtime.sendMessage({ type: MESSAGE_FETCH_IMAGE, url }, done));
}

async function embedImages(archive) {
  if (!els.embedImages.checked || !archive.images?.length) return archive;

  const enriched = structuredClone(archive);
  const imagesBySrc = new Map(enriched.images.map((image) => [image.src, image]));

  for (const image of enriched.images) {
    try {
      const response = await fetchImageDataUrl(image.src);
      if (response?.ok && response.dataUrl) image.dataUrl = response.dataUrl;
    } catch {}
  }

  enriched.blocks = enriched.blocks.map((block) => block.type === 'image'
    ? { type: 'image', image: imagesBySrc.get(block.image?.src) || block.image }
    : block
  );

  return enriched;
}

function renderImage(image, index) {
  const alt = /^image$/i.test(String(image.alt || '').trim()) ? '' : (image.alt || '');
  const src = image.dataUrl || image.src;
  const caption = alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : '';
  return `<figure>\n  <img src="${escapeHtml(src)}" alt="${escapeHtml(alt || `image ${index}`)}" loading="lazy">\n  ${caption}\n</figure>`;
}

function renderBlocks(blocks) {
  let imageIndex = 0;
  let openList = '';
  const html = [];

  function closeList() {
    if (!openList) return;
    html.push(`</${openList}>`);
    openList = '';
  }

  for (const block of blocks) {
    if (block.type === 'list-item') {
      const list = block.list === 'ol' ? 'ol' : 'ul';
      if (openList && openList !== list) closeList();
      if (!openList) {
        html.push(`<${list}>`);
        openList = list;
      }
      html.push(`<li>${sanitizeInlineHtml(block.html) || escapeHtml(block.text || '')}</li>`);
      continue;
    }

    closeList();
    if (block.type === 'image') html.push(renderImage(block.image || {}, ++imageIndex));
    else if (block.type === 'heading') html.push(`<h2>${sanitizeInlineHtml(block.html) || escapeHtml(block.text || '')}</h2>`);
    else html.push(`<p>${sanitizeInlineHtml(block.html) || escapeHtml(block.text || '')}</p>`);
  }

  closeList();
  return html.join('\n');
}

function articleHtml(archive) {
  const title = archive.title || 'Untitled';
  const author = [archive.author?.name, archive.author?.username].filter(Boolean).join(' ');
  const source = archive.canonicalUrl || archive.sourceUrl;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; --bg:#ffffff; --fg:#111111; --muted:#666666; --line:#e5e5e5; }
    @media (prefers-color-scheme: dark) { :root { --bg:#111111; --fg:#eeeeee; --muted:#999999; --line:#333333; } }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--fg); font:18px/1.65 Georgia, Cambria, 'Times New Roman', serif; }
    main { width:min(720px, calc(100% - 32px)); margin:48px auto; }
    header { margin-bottom:28px; padding-bottom:18px; border-bottom:1px solid var(--line); }
    h1 { margin:0 0 12px; font-size:clamp(32px, 6vw, 56px); line-height:1.05; letter-spacing:-0.04em; }
    h2 { margin:2em 0 .6em; font-size:1.45em; line-height:1.2; }
    .meta, .source, figcaption { color:var(--muted); font-size:14px; }
    .source a, article a { color:inherit; overflow-wrap:anywhere; text-decoration:underline; text-underline-offset:2px; }
    p { margin:0 0 1.05em; white-space:pre-wrap; }
    ul, ol { margin:0 0 1.2em; padding-left:1.35em; }
    li { margin:0 0 .65em; padding-left:.2em; }
    figure { margin:28px 0; }
    img { display:block; max-width:100%; height:auto; border-radius:12px; border:1px solid var(--line); }
    figcaption { margin-top:8px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${escapeHtml([author, formatDate(archive.publishedAt)].filter(Boolean).join(' Â· '))}</div>
      <div class="source"><a href="${escapeHtml(source)}">${escapeHtml(source)}</a></div>
    </header>
    <article>
${renderBlocks(archive.blocks || [])}
    </article>
  </main>
</body>
</html>`;
}

function indexHtml(entries) {
  const items = entries
    .slice()
    .sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)))
    .map((entry) => `<li><a href="/article/${escapeHtml(entry.slug)}/">${escapeHtml(entry.title)}</a><span>${escapeHtml(formatDate(entry.archivedAt))}</span></li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Archive</title>
  <style>
    :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; }
    @media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#eee; --muted:#999; --line:#333; } }
    body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    main { width:min(760px, calc(100% - 32px)); margin:48px auto; }
    h1 { font-size:34px; margin:0 0 24px; }
    ul { list-style:none; padding:0; margin:0; border-top:1px solid var(--line); }
    li { display:flex; justify-content:space-between; gap:16px; padding:14px 0; border-bottom:1px solid var(--line); }
    a { color:inherit; font-weight:600; text-decoration:none; }
    span { color:var(--muted); white-space:nowrap; }
  </style>
</head>
<body><main><h1>Archive</h1><ul>${items}</ul></main></body>
</html>`;
}

function archiveManifest(entries) {
  return JSON.stringify(entries.map(({ html, ...entry }) => entry), null, 2);
}

function sourceFromArticleHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('.source a')?.href || '';
}

async function fetchArticleHtml(baseUrl, slug) {
  try {
    const res = await fetch(`${baseUrl}/article/${encodeURIComponent(slug)}/index.html`, { cache: 'no-store' });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

async function fetchRemoteArchives(config) {
  const baseUrl = config.baseUrl.replace(/\/$/, '');

  try {
    const manifestRes = await fetch(`${baseUrl}/${ARCHIVE_MANIFEST}?t=${Date.now()}`, { cache: 'no-store' });
    if (manifestRes.ok) {
      const entries = await manifestRes.json();
      if (Array.isArray(entries)) {
        return Promise.all(entries.map(async (entry) => ({
          slug: entry.slug,
          title: entry.title,
          sourceUrl: entry.sourceUrl || '',
          archivedAt: entry.archivedAt || new Date().toISOString(),
          html: entry.html || await fetchArticleHtml(baseUrl, entry.slug)
        })));
      }
    }
  } catch {}

  try {
    const indexRes = await fetch(`${baseUrl}/?t=${Date.now()}`, { cache: 'no-store' });
    if (!indexRes.ok) return [];

    const doc = new DOMParser().parseFromString(await indexRes.text(), 'text/html');
    const links = [...doc.querySelectorAll('a[href^="/article/"]')];
    return Promise.all(links.map(async (link) => {
      const slug = link.getAttribute('href').split('/').filter(Boolean).pop();
      const html = await fetchArticleHtml(baseUrl, slug);
      return {
        slug,
        title: link.textContent.trim() || slug,
        sourceUrl: sourceFromArticleHtml(html),
        archivedAt: new Date().toISOString(),
        html
      };
    }));
  } catch {
    return [];
  }
}

function mergeArchives(...groups) {
  const byKey = new Map();
  for (const entry of groups.flat()) {
    if (!entry?.slug || !entry?.title || !entry?.html) continue;
    const key = entry.sourceUrl || entry.slug;
    const previous = byKey.get(key);
    byKey.set(key, {
      ...previous,
      ...entry,
      html: entry.html || previous?.html || '',
      archivedAt: entry.archivedAt || previous?.archivedAt || new Date().toISOString()
    });
  }
  return [...byKey.values()];
}

function uniqueSlug(title, sourceUrl, entries) {
  const existing = entries.find((entry) => entry.sourceUrl === sourceUrl);
  if (existing) return existing.slug;

  const base = slugify(title);
  const used = new Set(entries.map((entry) => entry.slug));
  if (!used.has(base)) return base;

  let suffix = Date.now().toString(36);
  let slug = `${base}-${suffix}`;
  while (used.has(slug)) {
    suffix = Math.random().toString(36).slice(2, 8);
    slug = `${base}-${suffix}`;
  }
  return slug;
}

function pagesAssetHash(path, content) {
  const extension = path.split('/').pop().includes('.') ? path.split('.').pop() : '';
  const base64Content = base64(content);
  const bytes = new TextEncoder().encode(base64Content + extension);
  return [...blake3(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function cloudflareFetch(path, config, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message = data.errors?.map((error) => error.message).join('; ') || `Cloudflare HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data.result;
}

async function ensureProject(config) {
  try {
    return await cloudflareFetch(`/accounts/${config.accountId}/pages/projects/${config.projectName}`, config);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  return cloudflareFetch(`/accounts/${config.accountId}/pages/projects`, config, {
    method: 'POST',
    body: JSON.stringify({ name: config.projectName, production_branch: 'main' })
  });
}

async function deployToCloudflare(files, config) {
  await ensureProject(config);

  const fileRecords = await Promise.all(Object.entries(files).map(async ([path, content]) => ({
    path,
    content,
    hash: pagesAssetHash(path, content),
    contentType: path.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'
  })));

  const jwtResult = await cloudflareFetch(`/accounts/${config.accountId}/pages/projects/${config.projectName}/upload-token`, config);
  const jwt = jwtResult.jwt;

  const hashes = fileRecords.map((file) => file.hash);
  const missing = await fetch(`${API}/pages/assets/check-missing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes })
  }).then((res) => res.json());

  const missingHashes = Array.isArray(missing.result) ? missing.result : hashes;
  const filesToUpload = fileRecords.filter((file) => missingHashes.includes(file.hash));

  if (filesToUpload.length) {
    const uploadPayload = filesToUpload.map((file) => ({
      key: file.hash,
      value: base64(file.content),
      metadata: { contentType: file.contentType },
      base64: true
    }));

    const upload = await fetch(`${API}/pages/assets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(uploadPayload)
    }).then((res) => res.json());
    if (upload.success === false) throw new Error(upload.errors?.map((error) => error.message).join('; ') || 'Asset upload failed');
  }

  await fetch(`${API}/pages/assets/upsert-hashes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes })
  }).catch(() => {});

  const manifest = Object.fromEntries(fileRecords.map((file) => [`/${file.path}`, file.hash]));
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));

  return cloudflareFetch(`/accounts/${config.accountId}/pages/projects/${config.projectName}/deployments`, config, {
    method: 'POST',
    body: form
  });
}

function configFromForm() {
  const projectName = els.projectName.value.trim() || 'ax';
  return {
    accountId: els.accountId.value.trim(),
    projectName,
    apiToken: els.apiToken.value.trim(),
    baseUrl: (els.baseUrl.value.trim() || `https://${projectName}.pages.dev`).replace(/\/$/, '')
  };
}

function applyConfig(config) {
  els.accountId.value = config.accountId || '';
  els.projectName.value = config.projectName || 'ax';
  els.apiToken.value = config.apiToken || '';
  els.baseUrl.value = config.baseUrl || (config.projectName ? `https://${config.projectName}.pages.dev` : '');
}

async function saveSettings() {
  const config = configFromForm();
  await storageSet({ cloudflareConfig: config });
  setStatus('Settings saved.', 'ok');
}

function renderPopupSummary(archive, publicUrl = '') {
  els.result.hidden = false;
  els.title.textContent = archive.title || 'Untitled';
  const author = [archive.author?.name, archive.author?.username].filter(Boolean).join(' ');
  els.meta.textContent = [author, formatDate(archive.publishedAt), `${archive.text.length} chars`, `${archive.images.length} images`].filter(Boolean).join(' Â· ');
  els.downloadHtmlBtn.disabled = false;
  if (publicUrl) {
    els.url.hidden = false;
    els.url.href = publicUrl;
    els.url.textContent = publicUrl;
  } else {
    els.url.hidden = true;
  }
}

async function archiveAndUpload() {
  setBusy(true);
  setStatus('');
  els.downloadHtmlBtn.disabled = true;

  try {
    const tab = await activeTab();
    if (!tab?.id || !isXUrl(tab.url)) throw new Error('Not an X tab.');

    const { cloudflareConfig, archives } = await storageGet({ cloudflareConfig: { projectName: 'ax' }, archives: [] });
    applyConfig(cloudflareConfig);
    const config = configFromForm();
    if (!config.accountId || !config.projectName || !config.apiToken) {
      els.settings.open = true;
      throw new Error('Cloudflare settings needed.');
    }

    setStatus('Extractingâ¦');
    const response = await extractFromTab(tab.id);
    if (!response?.ok) throw new Error(response?.error || 'Extraction failed.');
    if (!response.data?.ok || !response.data.blocks?.length) throw new Error('No article content found.');

    setStatus('Syncing archiveâ¦');
    const syncedArchives = mergeArchives(await fetchRemoteArchives(config), archives);

    currentArchive = await embedImages(response.data);
    currentHtml = articleHtml(currentArchive);

    const slug = uniqueSlug(currentArchive.title, currentArchive.canonicalUrl || currentArchive.sourceUrl, syncedArchives);
    const entry = {
      slug,
      title: currentArchive.title,
      sourceUrl: currentArchive.canonicalUrl || currentArchive.sourceUrl,
      archivedAt: new Date().toISOString(),
      html: currentHtml
    };
    const nextArchives = mergeArchives(syncedArchives.filter((item) => item.slug !== slug), [entry]);

    const files = {
      'index.html': indexHtml(nextArchives),
      [ARCHIVE_MANIFEST]: archiveManifest(nextArchives)
    };
    for (const item of nextArchives) files[`article/${item.slug}/index.html`] = item.html;

    setStatus('Uploadingâ¦');
    await deployToCloudflare(files, config);
    await storageSet({ archives: nextArchives, cloudflareConfig: config });

    const publicUrl = `${config.baseUrl}/article/${slug}/`;
    await navigator.clipboard.writeText(publicUrl).catch(() => {});
    renderPopupSummary(currentArchive, publicUrl);
    setStatus('Uploaded. URL copied.', 'ok');
  } catch (error) {
    currentArchive = null;
    currentHtml = '';
    els.result.hidden = true;
    setStatus(error?.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function downloadHtml() {
  if (!currentArchive || !currentHtml) return;
  const blob = new Blob([currentHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    await withChromeCallback((done) => chrome.downloads.download({ url, filename: `x-archives/${slugify(currentArchive.title)}-${Date.now()}.html`, saveAs: true }, done));
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

async function init() {
  const { cloudflareConfig } = await storageGet({ cloudflareConfig: { projectName: 'ax' } });
  applyConfig(cloudflareConfig);
}

els.archiveBtn.addEventListener('click', archiveAndUpload);
els.downloadHtmlBtn.addEventListener('click', downloadHtml);
els.saveSettingsBtn.addEventListener('click', saveSettings);
init();
