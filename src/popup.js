const MESSAGE_EXTRACT = 'X_ARCHIVER_EXTRACT';
const MESSAGE_FETCH_IMAGE = 'X_ARCHIVER_FETCH_IMAGE';

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
  siteUrl: document.getElementById('siteUrl'),
  uploadSecret: document.getElementById('uploadSecret'),
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
  els.archiveBtn.textContent = isBusy ? 'Working...' : 'Archive';
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
    h1 { margin:0 0 12px; font-size:clamp(32px, 6vw, 56px); line-height:1.05; }
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
      <div class="meta">${escapeHtml([author, formatDate(archive.publishedAt)].filter(Boolean).join(' - '))}</div>
      <div class="source"><a href="${escapeHtml(source)}">${escapeHtml(source)}</a></div>
    </header>
    <article>
${renderBlocks(archive.blocks || [])}
    </article>
  </main>
</body>
</html>`;
}

function configFromForm() {
  return {
    siteUrl: els.siteUrl.value.trim().replace(/\/$/, ''),
    uploadSecret: els.uploadSecret.value.trim()
  };
}

function applyConfig(config) {
  els.siteUrl.value = config.siteUrl || '';
  els.uploadSecret.value = config.uploadSecret || '';
}

function validateConfig(config) {
  if (!config.siteUrl || !config.uploadSecret) {
    els.settings.open = true;
    throw new Error('Archive settings needed.');
  }

  try {
    const url = new URL(config.siteUrl);
    if (url.protocol !== 'https:') throw new Error();
  } catch {
    els.settings.open = true;
    throw new Error('Use an https archive site URL.');
  }
}

async function saveSettings() {
  const config = configFromForm();
  validateConfig(config);
  await storageSet({ archiveConfig: config });
  setStatus('Settings saved.', 'ok');
}

function renderPopupSummary(archive, publicUrl = '') {
  els.result.hidden = false;
  els.title.textContent = archive.title || 'Untitled';
  const author = [archive.author?.name, archive.author?.username].filter(Boolean).join(' ');
  els.meta.textContent = [author, formatDate(archive.publishedAt), `${archive.text.length} chars`, `${archive.images.length} images`].filter(Boolean).join(' - ');
  els.downloadHtmlBtn.disabled = false;
  if (publicUrl) {
    els.url.hidden = false;
    els.url.href = publicUrl;
    els.url.textContent = publicUrl;
  } else {
    els.url.hidden = true;
  }
}

async function uploadArchive(config, payload) {
  const response = await fetch(`${config.siteUrl}/api/archive`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.uploadSecret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Upload failed (${response.status})`);
  }
  return data;
}

async function archiveAndUpload() {
  setBusy(true);
  setStatus('');
  els.downloadHtmlBtn.disabled = true;

  try {
    const tab = await activeTab();
    if (!tab?.id || !isXUrl(tab.url)) throw new Error('Open an X article or post first.');

    const { archiveConfig } = await storageGet({ archiveConfig: {} });
    applyConfig(archiveConfig);
    const config = configFromForm();
    validateConfig(config);

    setStatus('Extracting...');
    const response = await extractFromTab(tab.id);
    if (!response?.ok) throw new Error(response?.error || 'Extraction failed.');
    if (!response.data?.ok || !response.data.blocks?.length) throw new Error('No article content found.');

    currentArchive = await embedImages(response.data);
    currentHtml = articleHtml(currentArchive);

    const sourceUrl = currentArchive.canonicalUrl || currentArchive.sourceUrl;
    const slug = `${slugify(currentArchive.title)}-${currentArchive.statusId || Date.now().toString(36)}`;
    const archivedAt = new Date().toISOString();

    setStatus('Uploading...');
    const upload = await uploadArchive(config, {
      slug,
      title: currentArchive.title,
      sourceUrl,
      publishedAt: currentArchive.publishedAt || '',
      archivedAt,
      html: currentHtml
    });

    await storageSet({ archiveConfig: config });
    const publicUrl = upload.url || `${config.siteUrl}/article/${slug}/`;
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
  const { archiveConfig } = await storageGet({ archiveConfig: {} });
  applyConfig(archiveConfig);
}

els.archiveBtn.addEventListener('click', archiveAndUpload);
els.downloadHtmlBtn.addEventListener('click', downloadHtml);
els.saveSettingsBtn.addEventListener('click', saveSettings);
init();
