(() => {
  if (globalThis.__X_ARTICLE_ARCHIVER_CONTENT__) return;
  globalThis.__X_ARTICLE_ARCHIVER_CONTENT__ = true;

  const MESSAGE_EXTRACT = 'X_ARCHIVER_EXTRACT';

  const MAIN_CONTENT_SELECTOR = '[data-testid="twitterArticleReadView"], [data-testid="longformRichTextComponent"], article[data-testid="tweet"], article';
  const ARTICLE_BODY_SELECTOR = '[data-testid="twitterArticleReadView"], [data-testid="longformRichTextComponent"], [data-testid="articleBody"]';
  const TEXT_BLOCK_SELECTOR = [
    '[data-testid="twitter-article-title"]',
    '[data-testid="tweetText"]',
    '[data-testid="noteTweetText"]',
    'h1', 'h2', 'h3', 'p', 'li', 'blockquote', 'pre',
    '[data-block="true"]',
    'div[dir="auto"]'
  ].join(',');

  const REMOVE_FROM_INLINE_SELECTOR = 'button, [role="button"], svg, [aria-hidden="true"], [data-testid="User-Name"], img';
  const IGNORE_CONTEXT_SELECTOR = [
    'header', 'nav', 'aside', 'footer',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    '[data-testid="sidebarColumn"]', '[data-testid="BottomBar"]',
    '[aria-label="Timeline: Trending now"]'
  ].join(',');

  const UI_TEXT = new Set([
    'post', 'posts', 'article', 'articles', 'reply', 'replies', 'repost', 'reposts',
    'like', 'likes', 'view', 'views', 'share', 'copy link', 'show more', 'show less',
    'sign up', 'log in', 'subscribe', 'promoted', 'what’s happening', "what's happening",
    'who to follow', 'relevant people', 'trending', 'messages', 'home', 'explore',
    'notifications', 'communities', 'premium', 'profile', 'more', 'translate post'
  ]);

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function compactText(value) {
    return cleanText(value).replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isUiText(text) {
    const value = compactText(text).toLowerCase();
    if (!value || UI_TEXT.has(value)) return true;
    if (/^\d+[,.]?\d*\s*(k|m)?$/i.test(value)) return true;
    if (/^@?[a-z0-9_]{1,20}\s*·\s*(follow|following)$/i.test(value)) return true;
    return false;
  }

  function getMeta(...names) {
    for (const name of names) {
      const node = document.querySelector(`meta[property="${CSS.escape(name)}"], meta[name="${CSS.escape(name)}"]`);
      const value = node?.getAttribute('content');
      if (value) return cleanText(value);
    }
    return '';
  }

  function parseContentId(url = location.href) {
    try {
      const path = new URL(url).pathname;
      return path.match(/\/status(?:es)?\/(\d+)/)?.[1] || path.match(/\/i\/article\/(\d+)/)?.[1] || '';
    } catch {
      return '';
    }
  }

  function canonicalImageUrl(src) {
    if (!src) return '';
    try {
      const url = new URL(src, location.href);
      if (url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/')) {
        url.searchParams.set('name', 'orig');
      }
      return url.href;
    } catch {
      return src;
    }
  }

  function mediaImageFrom(img) {
    const image = {
      src: canonicalImageUrl(img.currentSrc || img.src),
      alt: cleanText(img.alt || ''),
      width: Math.round(img.getBoundingClientRect().width),
      height: Math.round(img.getBoundingClientRect().height)
    };

    if (!image.src) return null;
    if (/profile_images|emoji|abs-0-200x200|card_img/i.test(image.src)) return null;
    if (!/pbs\.twimg\.com\/(media|ext_tw_video_thumb)/i.test(image.src)) return null;
    return image;
  }

  function extractAuthor(root) {
    const main = document.querySelector('main[role="main"]') || document.querySelector('main') || document.body;
    const userName = root.querySelector('[data-testid="User-Name"]') || main.querySelector('[data-testid="User-Name"]');
    const lines = cleanText(userName?.innerText || '').split('\n').map(compactText).filter(Boolean);
    const username = lines.find((line) => line.startsWith('@')) || getMeta('twitter:creator');
    const name = lines.find((line) => !line.startsWith('@') && !line.startsWith('·') && !/^follow/i.test(line)) || getMeta('author') || '';

    let profileUrl = '';
    const profileLink = userName?.querySelector('a[href^="/"]');
    if (profileLink) {
      try { profileUrl = new URL(profileLink.getAttribute('href'), location.href).href; } catch {}
    }

    return { name, username, profileUrl };
  }

  function articleRoot() {
    const exact = document.querySelector('[data-testid="twitterArticleReadView"]');
    if (exact) return exact;

    const body = document.querySelector(ARTICLE_BODY_SELECTOR);
    return body?.closest('[data-testid="twitterArticleReadView"], article, main') || body || null;
  }

  function tweetRoot() {
    const id = parseContentId();
    const articles = [...document.querySelectorAll('main article')].filter(isVisible);
    if (!articles.length) return null;

    if (id) {
      const exact = articles.filter((article) => [...article.querySelectorAll('a[href*="/status/"], a[href*="/i/article/"]')].some((a) => {
        try {
          const path = new URL(a.getAttribute('href'), location.href).pathname;
          return path.includes(`/status/${id}`) || path.includes(`/i/article/${id}`);
        } catch {
          return false;
        }
      }));
      if (exact.length) return exact.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    }

    return articles.find((article) => article.querySelector('[data-testid="tweetText"]')) || articles[0] || null;
  }

  function titleFrom(root, blocks) {
    const titleNode = root.querySelector('[data-testid="twitter-article-title"], h1');
    const title = cleanText(titleNode?.innerText || titleNode?.textContent || '');
    if (title) return title;

    const metaTitle = getMeta('og:title', 'twitter:title')
      .replace(/\s+on\s+X:?\s*$/i, '')
      .replace(/\s*\/\s*X\s*$/i, '');
    if (cleanText(metaTitle)) return cleanText(metaTitle);

    const firstText = blocks.find((block) => block.type === 'text' || block.type === 'heading' || block.type === 'list-item')?.text || '';
    return firstText.length > 120 ? `${firstText.slice(0, 117).trim()}…` : firstText || 'Untitled';
  }

  async function waitForNextPaint() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function expandVisibleContent(root) {
    const control = [...root.querySelectorAll('[data-testid="tweet-text-show-more-link"], button, [role="button"], a')]
      .find((el) => /^(show more|more|read more|더 보기|もっと見る|看更多)$/i.test(compactText(el.textContent || '')) && isVisible(el));
    if (!control) return;
    control.click();
    await waitForNextPaint();
  }

  async function waitForMediaToHydrate(root) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if ([...root.querySelectorAll('img')].some((img) => mediaImageFrom(img))) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  function hasAncestorMatching(el, selector, boundary) {
    let parent = el.parentElement;
    while (parent && parent !== boundary) {
      if (parent.matches?.(selector)) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function isListItem(el) {
    const className = String(el.className || '');
    const style = window.getComputedStyle(el);
    return el.tagName === 'LI'
      || el.getAttribute('role') === 'listitem'
      || style.display === 'list-item'
      || /(^|\s)(longform-(un)?ordered-list-item|public-DraftStyleDefault-(un)?orderedListItem)(\s|$)/i.test(className);
  }

  function listType(el) {
    const className = String(el.className || '');
    const marker = window.getComputedStyle(el).listStyleType || '';
    if (/(^|\s)(longform-ordered-list-item|public-DraftStyleDefault-orderedListItem)(\s|$)/i.test(className)) return 'ol';
    if (/(^|\s)(longform-unordered-list-item|public-DraftStyleDefault-unorderedListItem)(\s|$)/i.test(className)) return 'ul';
    return /decimal|lower-|upper-|armenian|georgian/i.test(marker) ? 'ol' : 'ul';
  }

  function textFromBlock(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(REMOVE_FROM_INLINE_SELECTOR).forEach((node) => node.remove());
    return cleanText(clone.innerText || clone.textContent || '');
  }

  function inlineHtml(node, root) {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node;
    if (el.matches(REMOVE_FROM_INLINE_SELECTOR)) return '';
    if (el.tagName === 'BR') return '<br>';

    const children = [...el.childNodes].map((child) => inlineHtml(child, root)).join('');
    if (!children) return '';

    const href = el.tagName === 'A' ? el.getAttribute('href') : '';
    if (href) {
      let url = href;
      try { url = new URL(href, location.href).href; } catch {}
      return `<a href="${escapeHtml(url)}">${children}</a>`;
    }

    const style = window.getComputedStyle(el);
    if (el !== root && (el.tagName === 'STRONG' || el.tagName === 'B' || Number.parseInt(style.fontWeight, 10) >= 650)) return `<strong>${children}</strong>`;
    if (el !== root && (el.tagName === 'EM' || el.tagName === 'I' || style.fontStyle === 'italic')) return `<em>${children}</em>`;
    if (el !== root && (el.tagName === 'CODE' || el.tagName === 'PRE')) return `<code>${children}</code>`;
    return children;
  }

  function textBlockType(el) {
    if (isListItem(el)) return 'list-item';
    if (el.matches('[data-testid="twitter-article-title"]')) return 'title';
    if (/^H[1-3]$/.test(el.tagName)) return 'heading';

    const style = window.getComputedStyle(el);
    const size = Number.parseFloat(style.fontSize) || 0;
    const weight = Number.parseInt(style.fontWeight, 10) || (style.fontWeight === 'bold' ? 700 : 400);
    if (size >= 24 || (size >= 21 && weight >= 650)) return 'heading';
    return 'text';
  }

  function isCandidateTextBlock(el, boundary) {
    if (!isVisible(el) || el.closest(IGNORE_CONTEXT_SELECTOR)) return false;
    if (el.closest('button, [role="button"], [data-testid="User-Name"]')) return false;
    if (hasAncestorMatching(el, TEXT_BLOCK_SELECTOR, boundary)) return false;

    if (el.matches('div[dir="auto"]')) {
      const nested = el.querySelector('h1,h2,h3,p,li,blockquote,pre,[data-block="true"],div[dir="auto"]');
      if (nested && nested !== el) return false;
    }

    return true;
  }

  function collectBlocks(root, title, author) {
    const boundary = root.matches(MAIN_CONTENT_SELECTOR) ? root : root.closest(MAIN_CONTENT_SELECTOR) || root;
    const titleKey = compactText(title).toLowerCase();
    const authorKeys = [author.name, author.username].map((value) => compactText(value).toLowerCase()).filter(Boolean);

    const textBlocks = [...boundary.querySelectorAll(TEXT_BLOCK_SELECTOR)]
      .filter((el) => isCandidateTextBlock(el, boundary))
      .map((el) => ({ el, text: textFromBlock(el), type: textBlockType(el) }))
      .map((block) => ({ ...block, text: cleanText(block.text) }))
      .filter((block) => block.text.length > 1)
      .filter((block) => !isUiText(block.text))
      .filter((block) => compactText(block.text).toLowerCase() !== titleKey)
      .filter((block) => !authorKeys.includes(compactText(block.text).toLowerCase()))
      .filter((block) => !/^@\w+\s*·/.test(compactText(block.text)))
      .map((block) => ({
        type: block.type === 'title' ? 'heading' : block.type,
        list: block.type === 'list-item' ? listType(block.el) : undefined,
        text: block.text,
        html: inlineHtml(block.el, block.el),
        el: block.el
      }));

    const imageBlocks = [...boundary.querySelectorAll('img')]
      .filter(isVisible)
      .map((el) => ({ el, image: mediaImageFrom(el) }))
      .filter((block) => block.image)
      .map((block) => ({ type: 'image', image: block.image, el: block.el }));

    const ordered = [...textBlocks, ...imageBlocks].sort((a, b) => {
      if (a.el === b.el) return 0;
      return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const seenText = new Set();
    const seenImages = new Set();
    const blocks = [];

    for (const block of ordered) {
      if (block.type === 'image') {
        if (seenImages.has(block.image.src)) continue;
        seenImages.add(block.image.src);
        blocks.push({ type: 'image', image: block.image });
        continue;
      }

      const key = compactText(block.text).toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      blocks.push({ type: block.type, list: block.list, text: block.text, html: block.html });
    }

    return blocks;
  }

  function addImageIds(blocks) {
    let index = 1;
    return blocks.map((block) => {
      if (block.type !== 'image') return block;
      return { type: 'image', image: { id: `image-${index++}`, ...block.image } };
    });
  }

  async function extractFromRoot(root, kind) {
    await expandVisibleContent(root);
    if (kind === 'article') await waitForMediaToHydrate(root);

    const author = extractAuthor(root);
    const preliminaryTitle = getMeta('og:title', 'twitter:title') || document.title;
    const initialBlocks = collectBlocks(root, preliminaryTitle, author);
    const title = titleFrom(root, initialBlocks);
    const blocks = addImageIds(collectBlocks(root, title, author));
    const textBlocks = blocks.filter((block) => block.type !== 'image');
    const text = cleanText(textBlocks.map((block) => block.text).join('\n\n'));
    const images = blocks.filter((block) => block.type === 'image').map((block) => block.image);

    return {
      ok: Boolean(title || text || images.length),
      kind,
      sourceUrl: location.href,
      canonicalUrl: getMeta('og:url') || location.href,
      statusId: parseContentId(),
      title,
      author,
      publishedAt: root.querySelector('time')?.getAttribute('datetime') || document.querySelector('main time')?.getAttribute('datetime') || '',
      archivedAt: new Date().toISOString(),
      text,
      images,
      blocks
    };
  }

  async function extractCurrentXPage() {
    const root = articleRoot() || tweetRoot();
    if (!root) {
      return { ok: false, kind: 'unknown', sourceUrl: location.href, title: document.title, text: '', images: [], blocks: [] };
    }
    return extractFromRoot(root, articleRoot() ? 'article' : 'post');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_EXTRACT) return false;
    (async () => {
      try {
        sendResponse({ ok: true, data: await extractCurrentXPage() });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  });
})();
