// Movie-source endpoints backed by the separately hosted PASIYA movie scraper.
// The shared secret is added by system/registry.js on the server; it is never exposed to browsers.
import { param } from '../system/util.js';

const sources = [
  ['cinesubz', 'Cinesubz'],
  ['sinhalasub', 'SinhalaSub'],
  ['sublk', 'SubLK']
];

const endpoints = [];
for (const [slug, label] of sources) {
  endpoints.push(
    {
      path: `/api/movie/${slug}/search`,
      remote: `movie/${slug}/search`,
      category: 'Movies',
      name: `${label} — Movie search`,
      cost: 1,
      isNew: true,
      noProbe: true,
      desc: `Search movies on ${label}.`,
      params: [param('q', 'Avatar', 'Movie title or search query'), param('page', '1', 'Page number', false)],
    },
    {
      path: `/api/movie/${slug}/details`,
      remote: `movie/${slug}/details`,
      category: 'Movies',
      name: `${label} — Movie details`,
      cost: 1,
      isNew: true,
      noProbe: true,
      desc: `Get movie details from ${label}.`,
      params: [param('id', 'movie-id', 'Movie ID from search'), param('url', '', 'Movie page URL (if required by source)', false)],
    },
    {
      path: `/api/movie/${slug}/download`,
      remote: `movie/${slug}/download`,
      category: 'Movies',
      name: `${label} — Movie links`,
      cost: 1,
      isNew: true,
      noProbe: true,
      desc: `Get available source links for a ${label} movie.`,
      params: [param('id', 'movie-id', 'Movie ID from search'), param('url', '', 'Movie page URL (if required by source)', false)],
    }
  );
}

export default endpoints;
