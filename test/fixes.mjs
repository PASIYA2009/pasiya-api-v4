// Offline checks for the v4.0 fixes (news fallback tiers, web search engines, tempmail provider fallback, AI provider chain). Run: node test/fixes.mjs
import { ENDPOINTS } from '../system/registry.js';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) { fails++; if (x) console.log(x); } };
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const RSS = (t) => `<rss><channel><item><title>${t}</title><link>https://x.lk/1</link></item></channel></rss>`;
const BINGRSS = `<rss><channel><item><title>Bing hit</title><link>https://www.bing.com/news/apiclick.aspx?ref=x&amp;url=https%3A%2F%2Flankadeepa.lk%2Fa1</link></item></channel></rss>`;
let log = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input); log.push(url);
  // lankadeepa: own feeds all fail, Google News returns empty, Bing works
  if (url.includes('news.google.com')) return new Response('<rss><channel></channel></rss>');
  if (url.includes('bing.com/news/search')) return new Response(BINGRSS);
  if (url.includes('lankadeepa.lk')) return new Response('nope', { status: 404 });
  // dinamina: only the alternate /feed path works
  if (url === 'https://www.dinamina.lk/feed') return new Response(RSS('Dinamina OK'));
  if (url.includes('dinamina.lk')) return new Response('', { status: 404 });
  // web search: DDG blocked, Bing RSS works
  if (url.includes('html.duckduckgo.com')) return new Response('blocked', { status: 403 });
  if (url.includes('bing.com/search')) return new Response(RSS('Bing web hit'));
  // tempmail: mail.tm down, mail.gw works
  if (url.includes('api.mail.tm')) return new Response('err', { status: 500 });
  if (url.includes('api.mail.gw/domains')) return j({ 'hydra:member': [{ domain: 'gw.test' }] });
  if (url.includes('api.mail.gw/accounts')) return j({ id: 'x' }, 201);
  if (url.includes('api.mail.gw/token')) return j({ token: 't' });
  if (url.includes('api.mail.gw/messages')) return j({ 'hydra:totalItems': 0, 'hydra:member': [] });
  // AI: groq fails, cerebras answers; pollinations must never be called when a key provider works
  if (url.includes('api.groq.com')) return j({ error: { message: 'rate' } }, 429);
  if (url.includes('api.cerebras.ai')) return j({ choices: [{ message: { content: 'from cerebras' } }] });
  if (url.includes('text.pollinations.ai')) return j({ error: 'Free limit reached: 1 reply every 45 seconds per IP. Retry after 40s, or get unlimited replies' }, 429);
  return new Response('?', { status: 404 });
};
const run = (path, p = {}, env = {}) => ENDPOINTS.get(path).run(p, env, null);

let r = await run('/api/news/lankadeepa'); ok('news: own feed + Google empty -> Bing, link unwrapped', r.via === 'bing-news' && r.articles[0].link === 'https://lankadeepa.lk/a1', r);
r = await run('/api/news/dinamina'); ok('news: moved feed found on alternate /feed path', r.via === 'rss' && r.articles[0].title === 'Dinamina OK', r);
r = await run('/api/search/web', { q: 'sri lanka' }); ok('web search: DDG 403 -> Bing RSS', r.engine === 'bing' && r.results[0].title === 'Bing web hit', r);
r = await run('/api/tempmail/random'); ok('tempmail: mail.tm 500 -> mail.gw', r.address.endsWith('@gw.test') && r.provider === 'mail.gw', r);
const box = await run('/api/tempmail/mailbox', { id: r.id }); ok('tempmail mailbox on mail.gw', box.count === 0 && box.address === r.address, box);
log = [];
r = await run('/api/ai/llama', { prompt: 'hi' }, { GROQ_API_KEY: 'a', CEREBRAS_API_KEY: 'b' });
ok('ai: groq fails -> cerebras answers, pollinations untouched', r.provider === 'cerebras' && r.answer === 'from cerebras' && !log.some((u) => u.includes('pollinations')), r);
try { await run('/api/ai/gpt', { prompt: 'hi' }, {}); ok('ai: no keys + limit => clear error', false); } catch (e) { ok('ai: no keys -> 503 with how to fix', e.status === 503 && /GROQ_API_KEY/.test(e.message), e.message); }
log = [];
try { await run('/api/ai/gpt', { prompt: 'hi' }, {}); } catch (e) { ok('ai: pollinations limit remembered, 2nd call skips network', !log.some((u) => u.includes('pollinations')) && /retry in/.test(e.message), e.message); }
console.log(fails ? `\n${fails} FAILED` : '\nALL FIXES PASSED'); process.exit(fails ? 1 : 0);
