// Public live status for the dashboard cards (hosted on Vercel).
import { cached } from './util.js';
import * as fs from './db.js';
import { statsLast24h } from './gateway.js';
import { CATALOG } from './registry.js';

export async function status(req, env) {
  const h = (k) => req.headers.get(k);
  let db = { ok: false, name: 'Firebase Firestore', note: 'Not configured' };
  let stats = { requests: 0, errors: 0, avgMs: 0, successRate: 100 }, users = null;
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      stats = await cached('status:24h', 30, () => statsLast24h(env));
      users = await cached('status:users', 60, () => fs.count(env, 'users')).catch(() => null);
      db = { ok: true, name: 'Firebase Firestore', note: 'Connected' };
    } catch { db = { ok: false, name: 'Firebase Firestore', note: 'Unreachable' }; }
  }
  const started = env.PLATFORM_START ? new Date(env.PLATFORM_START).getTime() : null;
  let city = h('x-vercel-ip-city');
  try { city = city && decodeURIComponent(city); } catch { /* keep raw */ }
  return {
    status: db.ok || !env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'Online' : 'Degraded',
    ip: (h('x-forwarded-for') || '').split(',')[0].trim() || h('x-real-ip') || null,
    location: [city, h('x-vercel-ip-country')].filter(Boolean).join(', ') || null,
    edge: { colo: (h('x-vercel-id') || '').split('::')[0] || null, protocol: null, network: 'Vercel' },
    database: db,
    uptimeMs: started && !isNaN(started) ? Date.now() - started : null,
    endpoints: CATALOG.length,
    categories: new Set(CATALOG.map((c) => c.category)).size,
    users,
    requests24h: stats.requests, errors24h: stats.errors, avgResponseMs: stats.avgMs, successRate: stats.successRate,
    time: new Date().toISOString()
  };
}
