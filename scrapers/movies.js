// Movie & TV metadata. With a free TMDB key (TMDB_API_KEY / TMDB_READ_TOKEN) TMDB is used; with NO key the built-in
// keyless IMDb lookup answers search + details (ids look like tt1375666). Trending needs the TMDB key.
import { HttpError, fetchT, cached, clamp, decodeEntities, param } from '../system/util.js';
import { UA, page } from './_web.js';
const hasTmdb = (env) => !!(env.TMDB_API_KEY || env.TMDB_READ_TOKEN);

const IMG = 'https://image.tmdb.org/t/p/';
async function tmdb(env, path, qs = {}) {
  if (!env.TMDB_API_KEY && !env.TMDB_READ_TOKEN) throw new HttpError(503, 'Movie API is not enabled. The owner must add TMDB_API_KEY (free at themoviedb.org).');
  const u = new URL('https://api.themoviedb.org/3' + path);
  for (const [k, v] of Object.entries(qs)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  if (!env.TMDB_READ_TOKEN) u.searchParams.set('api_key', env.TMDB_API_KEY);
  const key = u.pathname + u.search.replace(/api_key=[^&]+/, '');
  return cached('tmdb:' + key, 21600, async () => {
    const r = await fetchT(u, env.TMDB_READ_TOKEN ? { headers: { Authorization: `Bearer ${env.TMDB_READ_TOKEN}` } } : {});
    if (r.status === 404) throw new HttpError(404, 'Not found.');
    if (!r.ok) throw new HttpError(502, 'Movie service error.');
    return r.json();
  });
}
const type = (p) => (String(p.type || 'movie').toLowerCase() === 'tv' ? 'tv' : 'movie');
const card = (x, t) => ({
  id: x.id, type: t, title: x.title || x.name, originalTitle: x.original_title || x.original_name,
  year: (x.release_date || x.first_air_date || '').slice(0, 4) || null, overview: x.overview || null,
  rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null, votes: x.vote_count || 0, language: x.original_language,
  poster: x.poster_path ? IMG + 'w500' + x.poster_path : null, backdrop: x.backdrop_path ? IMG + 'w780' + x.backdrop_path : null
});

async function search(p, env) {
  const q = String(p.q || p.query || '').trim();
  if (!q || q.length > 100) throw new HttpError(400, 'q is required (example: ?q=Inception).');
  if (!hasTmdb(env)) return imdbSearch(q);
  const t = type(p);
  const d = await tmdb(env, `/search/${t}`, { query: q, year: p.year, language: p.lang || 'en-US', page: clamp(p.page, 1, 20, 1), include_adult: 'false' });
  return { total: d.total_results, page: d.page, results: (d.results || []).slice(0, 15).map((x) => card(x, t)) };
}

async function details(p, env) {
  const imdb = String(p.id || '').trim().match(/^tt\d{5,10}$/)?.[0];
  if (imdb && !hasTmdb(env)) return imdbDetails(imdb);
  if (imdb) throw new HttpError(400, 'This is an IMDb id (tt...). Search again to get a TMDB id, or remove the TMDB key to use IMDb ids.');
  const id = clamp(p.id, 1, 1e9, 0);
  if (!id) throw new HttpError(400, 'id is required (get it from /api/movie/search).');
  const t = type(p);
  const d = await tmdb(env, `/${t}/${id}`, { language: p.lang || 'en-US', append_to_response: 'credits,videos' });
  const trailer = (d.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer') || (d.videos?.results || []).find((v) => v.site === 'YouTube');
  return {
    ...card(d, t), tagline: d.tagline || null, genres: (d.genres || []).map((g) => g.name), runtimeMin: d.runtime || d.episode_run_time?.[0] || null,
    status: d.status, seasons: d.number_of_seasons || null, episodes: d.number_of_episodes || null,
    cast: (d.credits?.cast || []).slice(0, 10).map((c) => ({ name: c.name, character: c.character, photo: c.profile_path ? IMG + 'w185' + c.profile_path : null })),
    directors: (d.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name),
    trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null, homepage: d.homepage || null
  };
}

async function imdbTrending(t) { // keyless: IMDb "most popular" chart (JSON-LD list on the public page)
  const results = await cached('imdbt:' + t, 21600, async () => {
    const html = await page(`https://www.imdb.com/chart/${t === 'tv' ? 'tvmeter' : 'moviemeter'}/`);
    let list = [];
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try { const j = JSON.parse(m[1]); if (Array.isArray(j.itemListElement)) { list = j.itemListElement; break; } } catch { /* next block */ }
    }
    if (!list.length) { // IMDb now ships the chart inside __NEXT_DATA__
      try {
        const nd = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1] || '');
        const edges = nd.props?.pageProps?.pageData?.chartTitles?.edges || [];
        list = edges.map((e) => e.node).filter(Boolean).map((n) => ({ url: '/title/' + n.id + '/', name: n.titleText?.text, alternateName: n.originalTitleText?.text, image: n.primaryImage?.url, aggregateRating: n.ratingsSummary ? { ratingValue: n.ratingsSummary.aggregateRating, ratingCount: n.ratingsSummary.voteCount } : null }));
      } catch { /* handled below */ }
    }
    if (!list.length) throw new HttpError(502, 'Movie source returned an unexpected page. Add a free TMDB_API_KEY for trending.');
    return list.slice(0, 20).map((e) => { const x = e.item || e; return {
      id: String(x.url || '').match(/tt\d+/)?.[0] || null, type: t, title: decodeEntities(x.name || ''), originalTitle: decodeEntities(x.alternateName || x.name || ''), year: null,
      overview: x.description ? decodeEntities(x.description) : null, rating: x.aggregateRating?.ratingValue || null, votes: x.aggregateRating?.ratingCount || 0, language: null, poster: x.image || null, backdrop: null }; }).filter((x) => x.id && x.title);
  });
  return { source: 'imdb', results };
}
async function trending(p, env) {
  const t = type(p);
  if (!hasTmdb(env)) return imdbTrending(t);
  const d = await tmdb(env, `/trending/${t}/${p.window === 'day' ? 'day' : 'week'}`, { language: p.lang || 'en-US' });
  return { results: (d.results || []).slice(0, 20).map((x) => card(x, t)) };
}

// ---------- Movies without a TMDB key (IMDb public suggestion + page data) ----------
async function imdbSearch(q) {
  const key = q.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60) || 'x';
  const d = await cached('imdbs:' + key, 21600, async () => {
    const r = await fetchT(`https://v3.sg.media-imdb.com/suggestion/${key[0]}/${encodeURIComponent(q)}.json`, { headers: { 'User-Agent': UA } }, 10000);
    if (!r.ok) throw new HttpError(502, 'Movie source is not answering right now.');
    return r.json();
  });
  const rows = (d.d || []).filter((x) => /^tt\d+$/.test(x.id));
  return { total: rows.length, page: 1, results: rows.map((x) => ({ id: x.id, type: /series/i.test(x.qid || x.q || '') ? 'tv' : 'movie', title: x.l, originalTitle: x.l, year: x.y ? String(x.y) : null, overview: null, rating: null, votes: 0, language: null, cast: x.s || null, poster: x.i?.imageUrl || null, backdrop: null })) };
}
async function imdbDetails(id) {
  return cached('imdbd:' + id, 21600, async () => {
    const html = await page(`https://www.imdb.com/title/${id}/`, { 'Accept-Language': 'en-US,en;q=0.9' });
    const m = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
    let ld; try { ld = JSON.parse(m?.[1] || ''); } catch { throw new HttpError(502, 'Movie source returned an unexpected page. Try again later.'); }
    const names = (x) => [].concat(x || []).map((a) => a.name).filter(Boolean);
    const dur = ld.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    return {
      id, type: /TVSeries/i.test(ld['@type']) ? 'tv' : 'movie', title: decodeEntities(ld.name || ''), originalTitle: decodeEntities(ld.alternateName || ld.name || ''), year: (ld.datePublished || '').slice(0, 4) || null,
      overview: ld.description ? decodeEntities(ld.description) : null, rating: ld.aggregateRating?.ratingValue || null, votes: ld.aggregateRating?.ratingCount || 0, language: null,
      poster: ld.image || null, backdrop: null, tagline: null, genres: [].concat(ld.genre || []), runtimeMin: dur ? (Number(dur[1] || 0) * 60 + Number(dur[2] || 0)) || null : null,
      status: null, seasons: null, episodes: null, cast: names(ld.actor).slice(0, 10).map((name) => ({ name, character: null, photo: null })), directors: names(ld.director),
      trailer: ld.trailer?.url || null, homepage: `https://www.imdb.com/title/${id}/`
    };
  });
}

const T = param('type', 'movie', 'movie or tv', false);
export default [
  { path: '/api/movie/search', category: 'Movies', name: 'Movie / TV search', cost: 1, desc: 'Titles, posters, ratings (TMDB, or keyless IMDb)', params: [param('q', 'Inception', 'Title'), T, param('year', '', 'Release year', false)], run: search },
  { path: '/api/movie/details', category: 'Movies', name: 'Movie / TV details', cost: 1, desc: 'Cast, genres, runtime, trailer', params: [param('id', 'tt1375666', 'Id from search (IMDb tt... works with no key; TMDB number needs TMDB_API_KEY)'), T], run: details },
  { path: '/api/movie/trending', category: 'Movies', name: 'Trending titles', cost: 1, desc: 'What is trending (TMDB, or keyless IMDb most-popular chart)', params: [T, param('window', 'week', 'day or week', false)], run: trending }
];
