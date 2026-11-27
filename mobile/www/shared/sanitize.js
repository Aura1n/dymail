const BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'meta',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'video',
  'audio',
  'source',
  'track',
  'svg',
  'math'
]);

const EMAIL_FONT = '"Segoe UI Variable Text", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

const EMAIL_CSS = `
  html { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    padding: 18px clamp(16px, 4vw, 30px) 44px;
    font-family: ${EMAIL_FONT};
    font-size: 14px;
    line-height: 1.65;
    color: #202124;
    overflow-wrap: anywhere;
    overflow-x: auto;
  }
  img { max-width: 100%; height: auto; }
  table, td, th, div { max-width: 100%; }
  td, th { word-break: break-word; }
  a { color: #0a63c9; }
  blockquote { margin: 0 0 0 12px; padding-left: 12px; border-left: 2px solid #d9d9de; color: #5d5d63; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; }
  hr { border: 0; border-top: 1px solid #e7e7ea; }
  ::selection { background: rgba(10, 132, 255, 0.2); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: rgba(60, 60, 67, 0.22); border: 3px solid transparent; background-clip: content-box; border-radius: 10px; }
  .plaintext { white-space: pre-wrap; }
`;

const DARK_INVERT = 'invert(1) hue-rotate(180deg)';

// Base colors are authored in light values and inverted as a whole so that
// author-defined contrast (dark text on light cards, logos, tables) survives.
const EMAIL_CSS_DARK = `
  html { color-scheme: dark; background: #1c1c1f; }
  html, body { margin: 0; padding: 0; }
  body {
    padding: 18px clamp(16px, 4vw, 30px) 44px;
    font-family: ${EMAIL_FONT};
    font-size: 14px;
    line-height: 1.65;
    color: #1d1d20;
    background: #e3e3e3;
    overflow-wrap: anywhere;
    overflow-x: auto;
    filter: ${DARK_INVERT};
  }
  img { max-width: 100%; height: auto; filter: ${DARK_INVERT}; }
  table, td, th, div { max-width: 100%; }
  td, th { word-break: break-word; }
  a { color: #0a63c9; }
  blockquote { margin: 0 0 0 12px; padding-left: 12px; border-left: 2px solid #d9d9de; color: #5d5d63; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; }
  hr { border: 0; border-top: 1px solid #cccccc; }
  ::selection { background: rgba(10, 132, 255, 0.25); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.22); border: 3px solid transparent; background-clip: content-box; border-radius: 10px; }
  .plaintext { white-space: pre-wrap; }
`;

const EMAIL_CSS_DARK_AUTHORED = `
  html { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #1c1c1f; }
  body {
    padding: 18px clamp(16px, 4vw, 30px) 44px;
    font-family: ${EMAIL_FONT};
    font-size: 14px;
    line-height: 1.65;
    color: #e8e8ee;
    overflow-wrap: anywhere;
    overflow-x: auto;
  }
  img { max-width: 100%; height: auto; }
  table, td, th, div { max-width: 100%; }
  td, th { word-break: break-word; }
  a { color: #6ab0ff; }
  blockquote { margin: 0 0 0 12px; padding-left: 12px; border-left: 2px solid #3a3a40; color: #a8a8b0; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; }
  hr { border: 0; border-top: 1px solid #333338; }
  ::selection { background: rgba(76, 158, 255, 0.3); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border: 3px solid transparent; background-clip: content-box; border-radius: 10px; }
  .plaintext { white-space: pre-wrap; }
`;

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function allowUrl(name, value) {
  const clean = String(value || '').trim();
  if (!clean) return false;
  if (name === 'src') {
    return /^data:image\//i.test(clean) || /^https?:\/\//i.test(clean) || /^cid:/i.test(clean);
  }
  return /^(https?:|mailto:|tel:)/i.test(clean);
}

function sanitizeDocument(doc) {
  for (const element of doc.querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tag)) {
      element.remove();
      continue;
    }
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      let value = attr.value;
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'srcset') {
        element.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style') {
        value = value
          .replace(/expression\s*\(/gi, '')
          .replace(/javascript\s*:/gi, '')
          .replace(/behavior\s*:/gi, '')
          // Fixed min-widths outrank max-width and are the usual cause of
          // content that cannot shrink into a narrow reading pane.
          .replace(/min-width\s*:\s*\d+(?:\.\d+)?(?:px|pt|%)\s*/gi, '');
        element.setAttribute('style', value);
        continue;
      }
      if (['href', 'src', 'background', 'poster'].includes(name)) {
        const isRemote = /^(?:https?:)?\/\//i.test(value.trim());
        if (/^\/\//.test(value.trim())) {
          value = `https:${value.trim()}`;
          element.setAttribute(attr.name, value);
        }
        if (!allowUrl(name, value) && !isRemote) {
          element.removeAttribute(attr.name);
          continue;
        }
        if (isRemote && !/^https?:/i.test(value.trim())) {
          element.setAttribute(attr.name, `https:${value.trim()}`);
        }
        continue;
      }
      if (name === 'xlink:href' || name === 'xmlns' || name === 'ping') {
        element.removeAttribute(attr.name);
      }
    }
    if (tag === 'a') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }
  for (const style of doc.querySelectorAll('style')) {
    style.textContent = style.textContent
      .replace(/@import[^;]+;/gi, '')
      .replace(/expression\s*\(/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/behavior\s*:/gi, '');
  }
}

function hasRemoteContent(doc) {
  for (const element of doc.querySelectorAll('img, image, table, body, div, td')) {
    const src = element.getAttribute && (element.getAttribute('src') || element.getAttribute('background'));
    if (src && /^(?:https?:)?\/\//i.test(src.trim())) return true;
    const style = element.getAttribute && element.getAttribute('style');
    if (style && /url\(\s*["']?\s*(?:https?:)?\/\//i.test(style)) return true;
  }
  for (const style of doc.querySelectorAll('style')) {
    if (/url\(\s*["']?\s*(?:https?:)?\/\//i.test(style.textContent || '')) return true;
  }
  return false;
}

function colorLuminance(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  let r;
  let g;
  let b;
  let match = /^#([0-9a-f]{6})$/.exec(v);
  if (match) {
    const hex = match[1];
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if ((match = /^#([0-9a-f]{3})$/.exec(v))) {
    r = parseInt(match[1][0] + match[1][0], 16);
    g = parseInt(match[1][1] + match[1][1], 16);
    b = parseInt(match[1][2] + match[1][2], 16);
  } else if ((match = /^rgba?\(([^)]+)\)$/.exec(v))) {
    const parts = match[1].split(',').map((part) => Number.parseFloat(part));
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
    [r, g, b] = parts;
  } else if (v === 'black') {
    r = g = b = 0;
  } else {
    return null;
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hasDarkAuthoredBackground(doc) {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element) continue;
    const style = element.getAttribute('style') || '';
    const match = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style);
    const bgcolor = element.getAttribute('bgcolor');
    const value = bgcolor || (match && match[1]);
    const luminance = colorLuminance(value);
    if (luminance !== null && luminance < 0.35) return true;
  }
  return false;
}

function injectShell(doc, allowRemote, dark) {
  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute(
    'content',
    [
      "default-src 'none'",
      `img-src data:${allowRemote ? ' http: https:' : ''}`,
      "style-src 'unsafe-inline'",
      "font-src data:",
      "media-src data:",
      "script-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-src 'none'"
    ].join('; ')
  );
  const referrer = doc.createElement('meta');
  referrer.setAttribute('name', 'referrer');
  referrer.setAttribute('content', 'no-referrer');
  const viewport = doc.createElement('meta');
  viewport.setAttribute('name', 'viewport');
  viewport.setAttribute('content', 'width=device-width, initial-scale=1');
  const style = doc.createElement('style');
  style.textContent = !dark
    ? EMAIL_CSS
    : hasDarkAuthoredBackground(doc)
      ? EMAIL_CSS_DARK_AUTHORED
      : EMAIL_CSS_DARK;
  doc.head.prepend(style);
  doc.head.prepend(viewport);
  doc.head.prepend(referrer);
  doc.head.prepend(csp);
}

function linkify(escapedText) {
  return escapedText.replace(/(https?:\/\/[^\s<]+)/gi, (url) => {
    const match = url.match(/^(.*?)([.,;:!?)]*)$/);
    const href = match ? match[1] : url;
    const tail = match ? match[2] : '';
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>${tail}`;
  });
}

export function buildEmailDocument({ html, text, allowRemote = false, theme = 'light' }) {
  const dark = theme === 'dark';
  if (html && html.trim()) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    sanitizeDocument(doc);
    const remote = hasRemoteContent(doc);
    injectShell(doc, allowRemote, dark);
    return {
      document: `<!DOCTYPE html>${doc.documentElement.outerHTML}`,
      hasRemote: remote
    };
  }
  const body = linkify(escapeHtml(text || ''));
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head><title></title></head><body><div class="plaintext">${body}</div></body></html>`,
    'text/html'
  );
  injectShell(doc, false, dark);
  return {
    document: `<!DOCTYPE html>${doc.documentElement.outerHTML}`,
    hasRemote: false
  };
}

export function htmlToText(html) {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const element of doc.querySelectorAll('script, style, head')) element.remove();
    const text = doc.body ? doc.body.textContent : '';
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return '';
  }
}
