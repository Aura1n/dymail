'use strict';

/* Body translation for the reader. MyMemory answers without any registration,
   but caps a request at ~500 bytes, so long paragraphs are split on sentence
   ends and stitched back together. A DeepL key, when the user has saved one,
   takes the whole batch in a single request and is much better at long prose;
   if that request fails we fall back to MyMemory instead of losing the mail. */

const MAX_SEGMENTS = 400;
const MAX_SEGMENT_CHARS = 2000;
const MYMEMORY_CHARS = 460;
const MYMEMORY_CONCURRENCY = 4;
const DEEPL_BATCH_CHARS = 42000;
const TIMEOUT_MS = 12000;

const DEEPL_HOSTS = { free: 'https://api-free.deepl.com/v2/translate', pro: 'https://api.deepl.com/v2/translate' };
const MYMEMORY_HOST = 'https://api.mymemory.translated.net/get';

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
};

function decodeEntities(value) {
  return String(value || '').replace(/&[#a-zA-Z0-9]+;/g, (token) =>
    Object.prototype.hasOwnProperty.call(ENTITIES, token) ? ENTITIES[token] : token
  );
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) throw new Error('翻译内容无效');
  return segments
    .slice(0, MAX_SEGMENTS)
    .map((item) => decodeEntities(String(item == null ? '' : item)).slice(0, MAX_SEGMENT_CHARS));
}

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await response.text();
  if (!response.ok) throw new Error(`翻译服务返回 ${response.status}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('翻译服务返回了无法解析的内容');
  }
}

/* Sentence-first splitting keeps MyMemory's 500-byte requests from cutting a
   clause in half; only a single oversized sentence is hard-cut. */
function splitLong(text, limit) {
  if (text.length <= limit) return [text];
  const pieces = text.match(/[^.!?\n]+[.!?]*[\n]*/g) || [text];
  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    for (let cursor = 0; cursor < piece.length; cursor += limit) {
      const slice = piece.slice(cursor, cursor + limit);
      if (current && current.length + slice.length > limit) {
        chunks.push(current);
        current = slice;
      } else {
        current += slice;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function myMemoryTranslate(text) {
  const chunks = splitLong(text, MYMEMORY_CHARS);
  const out = [];
  for (const chunk of chunks) {
    const url = `${MYMEMORY_HOST}?${new URLSearchParams({
      q: chunk,
      langpair: 'en|zh-CN',
      dl: 'zh-CN'
    })}`;
    const data = await requestJson(url);
    const translated = data && data.responseData ? data.responseData.translatedText : '';
    if (data && data.responseStatus !== undefined && Number(data.responseStatus) !== 200) {
      throw new Error(data.responseDetails || '翻译服务暂时不可用');
    }
    if (!String(translated || '').trim()) throw new Error('翻译服务没有返回内容');
    out.push(decodeEntities(translated));
  }
  return chunks.length > 1 ? out.join('') : out[0];
}

/* Runs up to four MyMemory requests at a time and keeps one result per input. */
async function myMemoryTranslateAll(texts) {
  const translated = new Array(texts.length).fill('');
  let cursor = 0;
  let failure = null;
  async function worker() {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      const text = texts[index];
      if (!text.trim()) continue;
      try {
        translated[index] = await myMemoryTranslate(text);
      } catch (err) {
        failure = failure || (err && err.message ? err.message : '翻译失败');
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(MYMEMORY_CONCURRENCY, texts.length); i += 1) workers.push(worker());
  await Promise.all(workers);
  return { translated, failure };
}

function deeplEndpoint(key) {
  return key.endsWith(':fx') ? DEEPL_HOSTS.free : DEEPL_HOSTS.pro;
}

async function deeplTranslateAll(texts, key) {
  const batches = [];
  let batch = [];
  let size = 0;
  for (const text of texts) {
    if (batch.length && size + text.length > DEEPL_BATCH_CHARS) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(text);
    size += text.length;
  }
  if (batch.length) batches.push(batch);

  const translated = new Array(texts.length).fill('');
  let offset = 0;
  for (const batchTexts of batches) {
    const wanted = [];
    const slots = [];
    batchTexts.forEach((text, index) => {
      if (text.trim()) {
        wanted.push(text);
        slots.push(offset + index);
      }
    });
    offset += batchTexts.length;
    if (!wanted.length) continue;

    const form = new URLSearchParams({ auth_key: key, target_lang: 'ZH-CN', source_lang: 'EN' });
    for (const text of wanted) form.append('text', text);
    const data = await requestJson(deeplEndpoint(key), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: form.toString()
    });
    const list = Array.isArray(data && data.translations) ? data.translations : [];
    if (list.length !== wanted.length) throw new Error('DeepL 返回的条目数量不对');
    slots.forEach((slot, index) => {
      const item = list[index];
      translated[slot] = decodeEntities(item && item.text ? item.text : '');
    });
  }
  return { translated, failure: null };
}

async function translateSegments(segments, { deeplKey = '' } = {}) {
  const texts = normalizeSegments(segments);
  const hasWork = texts.some((text) => text.trim());
  if (!hasWork) return { translated: texts.map(() => ''), provider: 'none', notice: '' };

  const key = String(deeplKey || '').trim();
  if (key) {
    try {
      const result = await deeplTranslateAll(texts, key);
      return { translated: result.translated, provider: 'deepl', notice: '' };
    } catch (err) {
      const notice = err && err.message ? err.message : 'DeepL 调用失败';
      const result = await myMemoryTranslateAll(texts);
      return {
        translated: result.translated,
        provider: 'mymemory',
        notice: `DeepL 不可用（${notice}），已改用免费翻译`
      };
    }
  }
  const result = await myMemoryTranslateAll(texts);
  return { translated: result.translated, provider: 'mymemory', notice: result.failure || '' };
}

module.exports = { translateSegments, splitLong, decodeEntities, MAX_SEGMENTS, MYMEMORY_CHARS };
