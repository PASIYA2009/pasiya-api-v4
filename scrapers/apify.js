// Social media data through Apify "actors" (the scraper catalogue listed in https://github.com/kawsarlog/social-media-apis).
// Needs ONE free key: APIFY_TOKEN (https://console.apify.com/account/integrations, free plan = monthly credits).
// Endpoints only appear once APIFY_TOKEN is set. They are never health-probed (every call spends Apify credits).
import { HttpError, fetchT, cached, clamp, param } from '../system/util.js';
import { safeUrl } from './_web.js';

const need = (v, name, max = 150) => { const x = String(v ?? '').trim(); if (!x || x.length > max) throw new HttpError(400, `${name} is required (max ${max} characters).`); return x; };
const handle = (v, name) => need(v, name, 100).replace(/^https?:\/\/[^/]+\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
const lim = (p, d = 10, max = 30) => clamp(p.limit, 1, max, d);

async function runActor(actor, input, env, ttl = 600) {
  return cached('apify:' + actor + ':' + JSON.stringify(input), ttl, async () => {
    const r = await fetchT(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=22&format=json&clean=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.APIFY_TOKEN}` }, body: JSON.stringify(input)
    }, 27000);
    const d = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) throw new HttpError(503, 'Apify token is invalid or out of credits. Owner: check APIFY_TOKEN.');
    if (r.status === 402) throw new HttpError(503, 'Apify credits are used up for this month.');
    if (r.status === 408 || r.status === 504) throw new HttpError(504, 'The social site took too long. Try a smaller limit.');
    if (!r.ok) throw new HttpError(502, 'Apify: ' + (d?.error?.message || 'HTTP ' + r.status));
    const items = Array.isArray(d) ? d : [];
    if (!items.length) throw new HttpError(404, 'Nothing found (private / empty / wrong name).');
    return items;
  });
}
// [path, name, desc, actor, params, build(p) -> input, platform]
const E = (path, name, desc, actor, params, build, platform) => ({
  path: '/api/social/' + path, category: 'Social', name, cost: 3, isNew: true, desc: desc + ' (via Apify)', needsEnv: ['APIFY_TOKEN'], noProbe: true, params,
  run: async (p, env) => { const items = await runActor(actor, build(p), env); return { platform, count: items.length, items }; }
});
const L = param('limit', '10', '1-30 results', false);

export default [
  E('tiktok/profile', 'TikTok Profile', 'Profile info + latest videos of a TikTok user', 'clockworks~tiktok-scraper', [param('username', 'khaby.lame', 'TikTok username'), L], (p) => ({ profiles: [handle(p.username, 'username')], resultsPerPage: lim(p, 5), shouldDownloadVideos: false, shouldDownloadCovers: false }), 'tiktok'),
  E('tiktok/search', 'TikTok Search', 'Search TikTok videos by keyword', 'clockworks~tiktok-scraper', [param('q', 'sri lanka', 'Search text'), L], (p) => ({ searchQueries: [need(p.q, 'q')], resultsPerPage: lim(p), shouldDownloadVideos: false }), 'tiktok'),
  E('tiktok/hashtag', 'TikTok Hashtag', 'Top videos of a TikTok hashtag', 'clockworks~tiktok-scraper', [param('tag', 'srilanka', 'Hashtag (no #)'), L], (p) => ({ hashtags: [need(p.tag, 'tag', 60).replace(/^#/, '')], resultsPerPage: lim(p), shouldDownloadVideos: false }), 'tiktok'),
  E('tiktok/comments', 'TikTok Comments', 'Comments of a public TikTok video', 'clockworks~tiktok-comments-scraper', [param('url', 'https://www.tiktok.com/@user/video/123', 'TikTok video link'), L], (p) => ({ postURLs: [safeUrl(p.url, ['tiktok.com'])], commentsPerPost: lim(p, 20) }), 'tiktok'),
  E('instagram/profile', 'Instagram Profile', 'Public profile info: bio, followers, posts count', 'apify~instagram-profile-scraper', [param('username', 'instagram', 'Instagram username')], (p) => ({ usernames: [handle(p.username, 'username')] }), 'instagram'),
  E('instagram/posts', 'Instagram Posts', 'Latest posts of a public Instagram user', 'apify~instagram-post-scraper', [param('username', 'natgeo', 'Instagram username'), L], (p) => ({ username: [handle(p.username, 'username')], resultsLimit: lim(p) }), 'instagram'),
  E('instagram/reels', 'Instagram Reels', 'Latest reels of a public Instagram user', 'apify~instagram-reel-scraper', [param('username', 'natgeo', 'Instagram username'), L], (p) => ({ username: [handle(p.username, 'username')], resultsLimit: lim(p) }), 'instagram'),
  E('instagram/hashtag', 'Instagram Hashtag', 'Recent posts of an Instagram hashtag', 'apify~instagram-hashtag-scraper', [param('tag', 'srilanka', 'Hashtag (no #)'), L], (p) => ({ hashtags: [need(p.tag, 'tag', 60).replace(/^#/, '')], resultsLimit: lim(p) }), 'instagram'),
  E('instagram/comments', 'Instagram Comments', 'Comments of a public post / reel', 'apify~instagram-comment-scraper', [param('url', 'https://www.instagram.com/p/abc/', 'Post or reel link'), L], (p) => ({ directUrls: [safeUrl(p.url, ['instagram.com'])], resultsLimit: lim(p, 20) }), 'instagram'),
  E('twitter/search', 'X (Twitter) Search', 'Search public tweets by keyword', 'apidojo~tweet-scraper', [param('q', 'sri lanka cricket', 'Search text'), param('limit', '10', '1-30 tweets', false)], (p) => ({ searchTerms: [need(p.q, 'q')], maxItems: lim(p), sort: 'Latest' }), 'twitter'),
  E('twitter/profile', 'X (Twitter) Profile Tweets', 'Latest tweets of a public X account', 'apidojo~tweet-scraper', [param('username', 'elonmusk', 'X username'), param('limit', '10', '1-30 tweets', false)], (p) => ({ twitterHandles: [handle(p.username, 'username')], maxItems: lim(p), sort: 'Latest' }), 'twitter'),
  E('youtube/search', 'YouTube Search', 'Search YouTube videos (title, views, channel, likes)', 'streamers~youtube-scraper', [param('q', 'sinhala songs', 'Search text'), param('limit', '10', '1-30 videos', false)], (p) => ({ searchQueries: [need(p.q, 'q')], maxResults: lim(p), maxResultsShorts: 0, maxResultStreams: 0 }), 'youtube'),
  E('youtube/comments', 'YouTube Comments', 'Comments of a YouTube video', 'streamers~youtube-comments-scraper', [param('url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YouTube link'), L], (p) => ({ startUrls: [{ url: safeUrl(p.url, ['youtube.com', 'youtu.be']) }], maxComments: lim(p, 20) }), 'youtube'),
  E('facebook/page', 'Facebook Page', 'Public Facebook page info (likes, followers, contact)', 'apify~facebook-pages-scraper', [param('url', 'https://www.facebook.com/nasa', 'Facebook page link')], (p) => ({ startUrls: [{ url: safeUrl(p.url, ['facebook.com']) }] }), 'facebook'),
  E('facebook/posts', 'Facebook Posts', 'Latest public posts of a Facebook page', 'apify~facebook-posts-scraper', [param('url', 'https://www.facebook.com/nasa', 'Facebook page link'), L], (p) => ({ startUrls: [{ url: safeUrl(p.url, ['facebook.com']) }], resultsLimit: lim(p, 5) }), 'facebook'),
  E('reddit/search', 'Reddit Search', 'Search Reddit posts by keyword', 'trudax~reddit-scraper-lite', [param('q', 'sri lanka', 'Search text'), L], (p) => ({ searches: [need(p.q, 'q')], type: 'posts', sort: 'relevance', maxItems: lim(p), skipComments: true }), 'reddit')
];
