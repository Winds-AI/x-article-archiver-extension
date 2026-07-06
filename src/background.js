async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'X_ARCHIVER_FETCH_IMAGE') return false;

  (async () => {
    try {
      const url = String(message.url || '');
      if (!/^https:\/\/(pbs|video)\.twimg\.com\//i.test(url)) {
        throw new Error('Refusing to fetch non-X media URL.');
      }
      const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
      if (!res.ok) throw new Error(`Image fetch failed: HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size > 12 * 1024 * 1024) {
        throw new Error('Image is larger than 12 MB; leaving it as a remote URL.');
      }
      sendResponse({ ok: true, dataUrl: await blobToDataUrl(blob), bytes: blob.size, type: blob.type });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();

  return true;
});
