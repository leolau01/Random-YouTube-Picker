// /api/random.js
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).setHeader('Allow', 'GET').end('Method Not Allowed');
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const API_KEY = process.env.YOUTUBE_API_KEY;
  if (!API_KEY) {
    res.status(500).end('Server is missing YOUTUBE_API_KEY');
    return;
  }

  const minViews = Math.max(100000, Number(req.query.minViews) || 100000);
  const withinDays = Math.min(365, Math.max(1, Number(req.query.days) || 365));
  const publishedAfter = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();

  const seeds = [
    'the','and','music','news','funny','review','how','game','movie','tech',
    'food','travel','sports','science','art','history','learning','live',
    'best','top','guide','vlog','2024','2025','interview','documentary'
  ];
  const pickSeed = () => seeds[Math.floor(Math.random() * seeds.length)];

  // --- NEW: minimal ISO 8601 PT#H#M#S parser
  function parseISODuration(iso) {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
    const h = Number(m?.[1] || 0), min = Number(m?.[2] || 0), s = Number(m?.[3] || 0);
    return h * 3600 + min * 60 + s;
  }

  async function searchOnce() {
    const q = pickSeed();
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('part', 'id');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('order', 'viewCount');
    url.searchParams.set('publishedAfter', publishedAfter);
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('safeSearch', 'moderate');
    url.searchParams.set('q', q);
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`search.list failed: ${r.status}`);
    return r.json();
  }

  async function hydrateAndFilter(ids) {
    if (!ids.length) return [];
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('key', API_KEY);
    // --- CHANGED: include contentDetails to get duration
    url.searchParams.set('part', 'snippet,statistics,contentDetails');
    url.searchParams.set('id', ids.join(','));

    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`videos.list failed: ${r.status}`);
    const data = await r.json();

    const cutoff = new Date(publishedAfter).getTime();
    const MIN_SECONDS = 180; // <- exclude most Shorts

    return (data.items || []).filter(v => {
      const views = Number(v.statistics?.viewCount || 0);
      const published = new Date(v.snippet?.publishedAt || 0).getTime();
      const seconds = parseISODuration(v.contentDetails?.duration);
      return (
        views >= minViews &&
        published >= cutoff &&
        Number.isFinite(seconds) &&
        seconds >= MIN_SECONDS
      );
    });
  }

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await searchOnce();
      const ids = (s.items || []).map(i => i.id?.videoId).filter(Boolean);
      const good = await hydrateAndFilter(ids);
      if (good.length) {
        const pick = good[Math.floor(Math.random() * good.length)];
        const payload = {
          id: pick.id,
          title: pick.snippet.title,
          channelTitle: pick.snippet.channelTitle,
          publishedAt: pick.snippet.publishedAt,
          viewCount: pick.statistics.viewCount,
          url: `https://www.youtube.com/watch?v=${pick.id}`
        };
        res.status(200).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload));
        return;
      }
    }
    res.status(404).end('No qualifying video found. Try again.');
  } catch (err) {
    console.error(err);
    res.status(500).end('Unexpected error fetching videos.');
  }
}
