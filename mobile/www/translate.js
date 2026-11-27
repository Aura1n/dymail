/* Body translation for the reader — the mobile port of the desktop planTranslation/applyTranslation.
 *
 * It works on the live DOM inside the (same-origin, sandboxed) mail iframe: text nodes are collected,
 * sent to the core in short pieces (the free MyMemory service caps a request at ~500 bytes), and the
 * answers are written back. The original text is remembered per node so "显示原文" is instant. */

const PIECE = 450;
const MAX_CHARS = 6000;
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TITLE', 'HEAD', 'IFRAME']);
const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT, spelled out because the iframe has its own NodeFilter

export function cjkRatio(text) {
  const eastern = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const total = eastern + latin;
  return total ? eastern / total : 0;
}

function collectTextNodes(doc) {
  const nodes = [];
  if (!doc.body) return nodes;
  const walker = doc.createTreeWalker(doc.body, SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.data.trim()) continue;
    if (parent && SKIP.has(parent.tagName)) continue;
    nodes.push(node);
  }
  return nodes;
}

function splitPiece(text, limit) {
  if (text.length <= limit) return [text];
  const parts = text.match(/[^.!?\n]+[.!?]*\n*|\n+/g) || [text];
  const pieces = [];
  let current = '';
  for (const part of parts) {
    if (current && current.length + part.length > limit) {
      pieces.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function planTranslation(nodes) {
  const entries = [];
  let used = 0;
  let truncated = false;
  for (const node of nodes) {
    const pieces = splitPiece(node.data, PIECE);
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      const core = piece.trim();
      if (core && used + core.length > MAX_CHARS) {
        truncated = true;
        /* Keep the tail as an untranslated entry so the body is never shortened. */
        entries.push({ node, piece: pieces.slice(index).join(''), core: '' });
        break;
      }
      if (core) used += core.length;
      entries.push({ node, piece, core });
    }
  }
  return { entries, segments: entries.filter((entry) => entry.core).map((entry) => entry.core), truncated };
}

export function applyTranslation(entries, translated) {
  const chunks = new Map();
  let cursor = 0;
  let done = 0;
  for (const entry of entries) {
    let text = entry.piece;
    if (entry.core) {
      const value = String(translated[cursor] || '').trim();
      cursor += 1;
      if (value) {
        const lead = entry.piece.slice(0, entry.piece.length - entry.piece.trimStart().length);
        const trail = entry.piece.slice(entry.piece.trimEnd().length);
        text = `${lead}${value}${trail}`;
        done += 1;
      }
    }
    chunks.set(entry.node, (chunks.get(entry.node) || '') + text);
  }
  const originals = [];
  for (const [node, text] of chunks) {
    originals.push([node, node.data]);
    node.data = text;
  }
  return { done, originals };
}

/* Translates the document in place. Resolves with { restore, notice, provider, truncated }. */
export async function translateDocument(doc, api) {
  const plan = planTranslation(collectTextNodes(doc));
  if (!plan.segments.length) throw new Error('没有可翻译的正文');
  if (cjkRatio(plan.segments.join(' ')) > 0.2) throw new Error('正文已是中文');
  const result = await api.translate.segments(plan.segments);
  const { done, originals } = applyTranslation(plan.entries, (result && result.translated) || []);
  if (!done) throw new Error((result && result.notice) || '翻译服务没有返回内容');
  return {
    restore: () => {
      for (const [node, text] of originals) node.data = text;
    },
    notice: (result && result.notice) || '',
    provider: (result && result.provider) || '',
    truncated: plan.truncated
  };
}
