const path = require('path');
const { translateSegments, splitLong, decodeEntities } = require(path.join(__dirname, '../../src/main/translate.js'));

let pass = 0;
let fail = 0;
const ok = (label, condition, extra) => {
  if (condition) {
    pass += 1;
    console.log(`PASS ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL ${label}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`);
  }
};

const calls = [];
function stubFetch(handler) {
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const result = handler(String(url), options);
    return {
      ok: result.status === undefined ? true : result.status >= 200 && result.status < 300,
      status: result.status === undefined ? 200 : result.status,
      text: async () => (typeof result.body === 'string' ? result.body : JSON.stringify(result.body))
    };
  };
}

(async () => {
  /* --- helpers --- */
  ok('decodeEntities', decodeEntities('A &amp; B &#39;c&#39; &quot;d&quot;') === `A & B 'c' "d"`);
  const chunks = splitLong('First sentence here. '.repeat(60), 460);
  ok('splitLong caps size', chunks.every((chunk) => chunk.length <= 460), chunks.map((c) => c.length));
  ok('splitLong keeps content', chunks.join('').replace(/\s+/g, ' ').trim().startsWith('First sentence here.'));

  /* --- MyMemory path --- */
  calls.length = 0;
  stubFetch((url) => {
    const query = new URL(url).searchParams.get('q');
    return { body: { responseStatus: 200, responseData: { translatedText: `中文[${query.replace(/&amp;/g, '&')}]` } } };
  });
  let result = await translateSegments(['Hello world', '', 'New login to your Grok Account']);
  ok('mymemory provider', result.provider === 'mymemory', result);
  ok('mymemory one request per text', calls.length === 2, calls.length);
  ok(
    'mymemory keeps slots',
    JSON.stringify(result.translated) === JSON.stringify(['中文[Hello world]', '', '中文[New login to your Grok Account]']),
    result.translated
  );
  ok('mymemory no notice', result.notice === '', result.notice);

  /* long text is stitched back from several requests */
  calls.length = 0;
  const long = 'Sentence number one is here. '.repeat(40);
  result = await translateSegments([long]);
  ok('mymemory chunked', calls.length === 3, calls.length);
  ok('mymemory chunk joined', result.translated[0].length > long.length, result.translated[0].length);

  /* a failing service leaves the original slot empty but reports why */
  calls.length = 0;
  stubFetch(() => ({ status: 429, body: 'slow down' }));
  result = await translateSegments(['Hello world']);
  ok('mymemory http error notice', /429/.test(result.notice), result.notice);
  ok('mymemory http error keeps slot', result.translated.length === 1 && result.translated[0] === '', result.translated);

  /* --- DeepL path --- */
  calls.length = 0;
  stubFetch((url, options) => {
    if (/api-free\.deepl\.com/.test(url)) {
      const form = new URLSearchParams(options.body);
      const texts = form.getAll('text');
      return { body: { translations: texts.map((text) => ({ text: `D[${text}]` })) } };
    }
    return { body: { responseStatus: 200, responseData: { translatedText: 'M' } } };
  });
  result = await translateSegments(['Alpha', '', 'Beta', '   '], { deeplKey: 'abc123:fx' });
  ok('deepl provider', result.provider === 'deepl', result);
  ok('deepl single batch', calls.length === 1, calls.length);
  ok('deepl free host', /api-free\.deepl\.com/.test(calls[0].url), calls[0].url);
  ok(
    'deepl keeps slots with blanks',
    JSON.stringify(result.translated) === JSON.stringify(['D[Alpha]', '', 'D[Beta]', '']),
    result.translated
  );
  ok('deepl source form', new URLSearchParams(calls[0].options.body).getAll('text').join('|') === 'Alpha|Beta');

  calls.length = 0;
  stubFetch(() => ({ body: { translations: [{ text: 'D' }] } }));
  await translateSegments(['Alpha'], { deeplKey: 'abc123:fa' });
  ok('deepl pro host', /api\.deepl\.com/.test(calls[0].url), calls[0].url);

  /* --- DeepL failure falls back to MyMemory --- */
  calls.length = 0;
  stubFetch((url) => {
    if (/deepl/.test(url)) return { status: 403, body: { message: 'Unauthorized' } };
    return { body: { responseStatus: 200, responseData: { translatedText: 'M' } } };
  });
  result = await translateSegments(['Hello world'], { deeplKey: 'bad:fx' });
  ok('fallback provider', result.provider === 'mymemory', result);
  ok('fallback translated', result.translated[0] === 'M', result.translated);
  ok('fallback notice', /DeepL 不可用/.test(result.notice), result.notice);

  /* --- input guards --- */
  result = await translateSegments([]);
  ok('empty input', result.provider === 'none' && result.translated.length === 0, result);
  let guarded = false;
  try {
    await translateSegments('not an array');
  } catch {
    guarded = true;
  }
  ok('non-array guarded', guarded);
})().catch((err) => {
  console.log('THREW', err && err.message);
  fail += 1;
})
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
