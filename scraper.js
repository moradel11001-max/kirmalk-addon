const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { resolveEmbed } = require('./resolver');

const BASE = 'https://kirmalk.com';
const CACHE_FILE = path.join(__dirname, 'cache.json');

// ---------- HTTP Client ----------
const http = axios.create({
  headers: {
    'User-Agent': 'okhttp/4.9.3',
    'Accept-Language': 'ar,en;q=0.8',
    'Referer': BASE
  },
  timeout: 15000,
  maxRedirects: 5
});

// ---------- Stremio Manifest ----------
const manifest = {
  id: "org.kirmalk.addon",
  version: "1.0.0",
  name: "Kirmalk TV",
  description: "أفلام ومسلسلات موقع كرمالك بجودة عالية (Kirmalk Addon)",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "kirmalk_movies",
      name: "كرمالك - أفلام",
      extra: [
        {
          name: "genre",
          options: ["الكل", "أفلام عربي", "مسرحيات"],
          isRequired: false
        },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "kirmalk_series",
      name: "كرمالك - مسلسلات",
      extra: [
        {
          name: "genre",
          options: ["الكل", "مسلسلات تركية", "مسلسلات مصرية", "مسلسلات شامية", "مسلسلات خليجية", "مسلسلات رمضان"],
          isRequired: false
        },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ],
  idPrefixes: ["km_"]
};

// ---------- Static Fallback Catalog (Bundled) ----------
let initialData = {};
try {
  const initFile = path.join(__dirname, 'initial_data.json');
  if (fs.existsSync(initFile)) {
    initialData = JSON.parse(fs.readFileSync(initFile, 'utf8'));
  }
} catch (e) {
  console.error('Failed to load initial_data.json:', e);
}

function getFallbackMetas(type, genre, search) {
  if (search) {
    const q = search.toLowerCase().trim();
    const all = [
      ...(initialData.movies || []),
      ...(initialData.series || []),
      ...(initialData.turkish || []),
      ...(initialData.egyptian || []),
      ...(initialData.syrian || []),
      ...(initialData.gulf || []),
      ...(initialData.ramadan || []),
      ...(initialData.plays || [])
    ];
    const seen = new Set();
    const results = [];
    for (const item of all) {
      if (!seen.has(item.id) && item.name.toLowerCase().includes(q)) {
        if (!type || item.type === type) {
          seen.add(item.id);
          results.push(item);
        }
      }
    }
    return results;
  }

  if (type === 'movie') {
    if (genre === 'مسرحيات') {
      return initialData.plays || [];
    }
    return initialData.movies || [];
  }

  // type === 'series'
  if (genre === 'مسلسلات تركية') {
    return initialData.turkish || [];
  } else if (genre === 'مسلسلات مصرية') {
    return initialData.egyptian || [];
  } else if (genre === 'مسلسلات شامية') {
    return initialData.syrian || [];
  } else if (genre === 'مسلسلات خليجية') {
    return initialData.gulf || [];
  } else if (genre === 'مسلسلات رمضان') {
    return initialData.ramadan || [];
  }

  // General series: combine series + turkish + egyptian
  const combined = [
    ...(initialData.series || []),
    ...(initialData.turkish || []),
    ...(initialData.egyptian || [])
  ];
  const seen = new Set();
  const list = [];
  for (const item of combined) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      list.push(item);
    }
  }
  return list;
}

// ---------- Persistent Cache ----------
let cache = {};
try {
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
} catch (_) {
  cache = {};
}

function getCache(key) {
  const item = cache[key];
  if (item && item.expires > Date.now()) {
    return item.data;
  }
  return null;
}

function setCache(key, data, ttlMs = 1800000) {
  cache[key] = {
    data,
    expires: Date.now() + ttlMs
  };
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) {}
}

// ---------- Helpers ----------
function normalizeUrl(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (trimmed.startsWith('/')) return BASE + trimmed;
  return trimmed;
}

function extractVid(href) {
  if (!href) return null;
  const m = href.match(/vid=([a-z0-9]+)/i);
  return m ? m[1] : null;
}

function cleanId(id) {
  if (!id) return '';
  return id.replace(/^km_[ms]_?/, '').replace(/^km_/, '');
}

function extractEpisode(title) {
  if (!title) return null;
  const m = title.match(/الحلقة\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function durationToSeconds(dur) {
  if (!dur) return null;
  const parts = dur.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function formatPoster(rawUrl, hostUrl) {
  if (!rawUrl) return null;
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return null;
  if (hostUrl) {
    return `${hostUrl}/proxy/image.jpg?url=${encodeURIComponent(normalized)}`;
  }
  return normalized;
}

function parseCards($, defaultType = 'movie') {
  const metas = [];

  $('.video-card').each((_, el) => {
    const card = $(el);
    const link = card.find('.video-title a').length
      ? card.find('.video-title a')
      : card.find('a.video-link');

    const href = link.attr('href') || card.find('a.video-link').attr('href');
    const vid = extractVid(href);
    if (!vid) return;

    let title = (link.attr('title') || link.text() || '').replace(/\s+/g, ' ').trim();
    if (!title) return;

    const img = card.find('img.thumbnail-image, img');
    let rawPoster = img.attr('data-src') || img.attr('data-original') || img.attr('src') || null;
    if (rawPoster && rawPoster.startsWith('data:image')) {
      rawPoster = img.attr('data-src') || img.attr('data-original') || null;
    }
    const poster = normalizeUrl(rawPoster);

    const durText = card.find('.video-meta .meta-item span').first().text().trim();
    const runtimeSec = durationToSeconds(durText);

    let type = defaultType;
    if (/الحلقة|مسلسل/i.test(title)) {
      type = 'series';
    } else if (/فيلم|مسرحية/i.test(title)) {
      type = 'movie';
    }

    const idPrefix = type === 'series' ? 'km_s_' : 'km_m_';

    metas.push({
      id: `${idPrefix}${vid}`,
      type,
      name: title,
      poster,
      runtime: runtimeSec ? `${Math.round(runtimeSec / 60)} min` : undefined
    });
  });

  return metas;
}

// ---------- Scraping Catalog Methods ----------
async function scrapeMovies(page = 1) {
  const url = page > 1 ? `${BASE}/movies.php?page=${page}` : `${BASE}/movies.php`;
  const { data } = await http.get(url);
  const $ = cheerio.load(data);
  return parseCards($, 'movie');
}

async function scrapeSeries(page = 1) {
  const url = page > 1
    ? `${BASE}/search.php?keywords=${encodeURIComponent('مسلسل')}&page=${page}`
    : `${BASE}/search.php?keywords=${encodeURIComponent('مسلسل')}`;
  const { data } = await http.get(url);
  const $ = cheerio.load(data);
  return parseCards($, 'series');
}

async function scrapeSearch(query, page = 1) {
  const url = page > 1
    ? `${BASE}/search.php?keywords=${encodeURIComponent(query)}&page=${page}`
    : `${BASE}/search.php?keywords=${encodeURIComponent(query)}`;
  const { data } = await http.get(url);
  const $ = cheerio.load(data);
  return parseCards($, 'movie');
}

async function scrapeCategory(cat, page = 1, defaultType = 'series') {
  const url = page > 1
    ? `${BASE}/category.php?cat=${cat}&page=${page}`
    : `${BASE}/category.php?cat=${cat}`;
  const { data } = await http.get(url);
  const $ = cheerio.load(data);
  return parseCards($, defaultType);
}

// ---------- High-Level getCatalog for Stremio ----------
async function getCatalog(type, extra = {}, hostUrl = '') {
  let skip = 0;
  let search = null;
  let genre = null;

  if (typeof extra === 'number' || typeof extra === 'string') {
    skip = parseInt(extra, 10) || 0;
  } else if (typeof extra === 'object' && extra !== null) {
    skip = parseInt(extra.skip, 10) || 0;
    search = extra.search || null;
    genre = extra.genre || null;
  }

  if (genre === 'الكل') {
    genre = null;
  }

  const page = Math.floor(skip / 20) + 1;
  const cacheKey = `catalog_${type}_${search || genre || 'all'}_p${page}`;

  let metas = getCache(cacheKey);
  if (!metas || metas.length === 0) {
    try {
      if (search) {
        metas = await scrapeSearch(search, page);
        if (type === 'movie') {
          metas = metas.filter(m => m.type === 'movie');
        } else if (type === 'series') {
          metas = metas.filter(m => m.type === 'series');
        }
      } else if (type === 'movie') {
        if (genre === 'مسرحيات') {
          metas = await scrapeSearch('مسرحية', page);
        } else {
          metas = await scrapeMovies(page);
        }
      } else {
        // Series
        if (genre === 'مسلسلات تركية') {
          metas = await scrapeCategory('turk14', page, 'series');
        } else if (genre === 'مسلسلات مصرية') {
          metas = await scrapeCategory('serieseg4', page, 'series');
        } else if (genre === 'مسلسلات شامية') {
          metas = await scrapeCategory('seriessy5', page, 'series');
        } else if (genre === 'مسلسلات خليجية') {
          metas = await scrapeCategory('series5l', page, 'series');
        } else if (genre === 'مسلسلات رمضان') {
          metas = await scrapeCategory('rmadan27', page, 'series');
        } else {
          metas = await scrapeSeries(page);
        }
      }

      if (metas && metas.length > 0) {
        setCache(cacheKey, metas, 1800000);
      }
    } catch (err) {
      console.warn(`Live scrape failed for ${type} (${genre || 'all'}): ${err.message}. Using fallback catalog.`);
    }
  }

  // Fallback if live scrape was empty or failed
  if (!metas || metas.length === 0) {
    const fallbackList = getFallbackMetas(type, genre, search);
    metas = fallbackList.slice(skip, skip + 50);
    if (metas.length === 0 && skip === 0) {
      metas = fallbackList.slice(0, 50);
    }
  }

  const formattedMetas = (metas || []).map(m => ({
    ...m,
    poster: formatPoster(m.poster, hostUrl)
  }));

  return { metas: formattedMetas };
}

// ---------- Scraping Meta (Item Details + Episodes) ----------
async function getMeta(type, id, hostUrl = '') {
  const cacheKey = `meta_${id}`;
  let meta = getCache(cacheKey);

  if (!meta) {
    const cleanVid = cleanId(id);
    try {
      const { data } = await http.get(`${BASE}/watch.php?vid=${cleanVid}`);
      const $ = cheerio.load(data);

      const title = $('h1.modern-video-title').text().trim() ||
                    $('meta[property="og:title"]').attr('content') ||
                    cleanVid;

      const rawPoster = $('meta[property="og:image"]').attr('content') ||
                        $('link[itemprop="thumbnailUrl"]').attr('href') ||
                        $('.thumbnail-image').attr('src');
      const poster = normalizeUrl(rawPoster);

      const rawBackground = $('.modern-player-wrapper').css('background-image') || poster;
      let background = poster;
      const bgMatch = (rawBackground || '').match(/url\(["']?([^"']+)["']?\)/);
      if (bgMatch) background = normalizeUrl(bgMatch[1]);

      const description = $('.video-description p').map((_, el) => $(el).text().trim()).get().join('\n') ||
                          $('meta[property="og:description"]').attr('content') ||
                          '';

      const genres = [];
      $('.details-line span a, .watch-information-section a[href*="category.php"]').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !genres.includes(text)) genres.push(text);
      });

      let seriesName = title;
      $('.details-line').each((_, el) => {
        const text = $(el).text();
        if (text.includes('المسلسل:')) {
          const parts = text.split('المسلسل:');
          if (parts[1]) seriesName = parts[1].trim();
        }
      });

      meta = {
        id,
        type,
        name: type === 'series' ? seriesName : title,
        poster,
        background,
        description,
        genres
      };

      if (type === 'series' || $('.episodes-grid-classic').length > 0) {
        meta.type = 'series';
        const videos = [];

        $('.episodes-grid-classic a.classic-episode-item').each((idx, el) => {
          const epHref = $(el).attr('href');
          const epVid = extractVid(epHref);
          if (!epVid) return;

          const numText = $(el).find('.episode-number-large').text().trim();
          const epNum = parseInt(numText, 10) || (idx + 1);

          videos.push({
            id: `${id}:1:${epNum}:${epVid}`,
            title: `الحلقة ${epNum}`,
            season: 1,
            episode: epNum
          });
        });

        if (videos.length === 0) {
          const epNum = extractEpisode(title) || 1;
          videos.push({
            id: `${id}:1:${epNum}:${cleanVid}`,
            title: `الحلقة ${epNum}`,
            season: 1,
            episode: epNum
          });
        }

        videos.sort((a, b) => a.episode - b.episode);
        meta.videos = videos;
      }

      setCache(cacheKey, meta, 7200000);
    } catch (err) {
      console.warn(`getMeta failed for ${id}: ${err.message}. Using fallback meta.`);
      const all = [
        ...(initialData.movies || []),
        ...(initialData.series || []),
        ...(initialData.turkish || []),
        ...(initialData.egyptian || []),
        ...(initialData.syrian || []),
        ...(initialData.gulf || []),
        ...(initialData.ramadan || []),
        ...(initialData.plays || [])
      ];
      const found = all.find(item => item.id === id);
      meta = {
        id,
        type: found ? found.type : type,
        name: found ? found.name : 'فيديو',
        poster: found ? found.poster : null,
        background: found ? found.poster : null,
        description: found ? found.name : ''
      };
      if (meta.type === 'series') {
        const epNum = extractEpisode(meta.name) || 1;
        meta.videos = [{
          id: `${id}:1:${epNum}:${cleanVid}`,
          title: `الحلقة ${epNum}`,
          season: 1,
          episode: epNum
        }];
      }
    }
  }

  return {
    ...meta,
    poster: formatPoster(meta.poster, hostUrl),
    background: formatPoster(meta.background, hostUrl)
  };
}

// ---------- Scraping Watch Servers (view.php) ----------
async function scrapeWatchServers(vid) {
  const cleanVid = cleanId(vid);

  // 1. Check bundled servers cache first!
  if (initialData.servers && initialData.servers[cleanVid] && initialData.servers[cleanVid].length > 0) {
    return { servers: initialData.servers[cleanVid] };
  }

  const servers = [];

  try {
    const { data } = await http.get(`${BASE}/view.php?vid=${cleanVid}`);
    const $ = cheerio.load(data);

    $('#WatchServers .server-btn').each((_, el) => {
      const btn = $(el);
      const embed = btn.attr('data-embed');
      if (!embed) return;
      servers.push({
        server: parseInt(btn.attr('data-server') || '0', 10),
        label: btn.find('span').text().trim() || `سيرفر ${btn.attr('data-server')}`,
        embed
      });
    });

    if (servers.length === 0) {
      const iframeSrc = $('#Playerholder iframe').attr('src');
      if (iframeSrc) {
        servers.push({
          server: 1,
          label: 'سيرفر رئيسي',
          embed: iframeSrc
        });
      }
    }
  } catch (err) {
    console.error('view.php fetch error:', err.message);
  }

  if (servers.length === 0) {
    try {
      const { data } = await http.get(`${BASE}/watch.php?vid=${cleanVid}`);
      const $ = cheerio.load(data);
      const embedUrl = $('link[itemprop="embedUrl"]').attr('href');
      if (embedUrl) {
        servers.push({
          server: 1,
          label: 'سيرفر رئيسي',
          embed: embedUrl
        });
      }
    } catch (_) {}
  }

  return { servers };
}

// ---------- High-Level getStreamsFor for Stremio ----------
async function getStreamsFor(baseId, season, episode, hostUrl = '') {
  let targetVid = null;

  if (typeof baseId === 'string' && baseId.includes(':')) {
    const parts = baseId.split(':');
    if (parts.length >= 4 && parts[3]) {
      targetVid = parts[3];
    } else {
      const epNum = parseInt(parts[2], 10) || 1;
      const meta = await getMeta('series', parts[0]);
      const ep = meta?.videos?.find(v => v.episode === epNum);
      if (ep && ep.id.includes(':')) {
        targetVid = ep.id.split(':')[3] || cleanId(parts[0]);
      } else {
        targetVid = cleanId(parts[0]);
      }
    }
  } else if (season && episode) {
    const epNum = parseInt(episode, 10);
    const meta = await getMeta('series', baseId);
    const ep = meta?.videos?.find(v => v.episode === epNum);
    if (ep && ep.id.includes(':')) {
      targetVid = ep.id.split(':')[3] || cleanId(baseId);
    } else {
      targetVid = cleanId(baseId);
    }
  } else {
    targetVid = cleanId(baseId);
  }

  if (!targetVid) return [];

  const { servers } = await scrapeWatchServers(targetVid);
  if (!servers || servers.length === 0) return [];

  const streamPromises = servers.map(async (s) => {
    try {
      const resolved = await resolveEmbed(s.embed);
      if (resolved && resolved.length > 0) {
        return resolved.map(r => {
          const referer = r.referer || s.embed;
          const isHls = r.url.includes('.m3u8') || (r.title && r.title.includes('HLS'));
          const endpoint = isHls ? '/proxy/stream.m3u8' : '/proxy/video.mp4';
          const streamUrl = hostUrl
            ? `${hostUrl}${endpoint}?url=${encodeURIComponent(r.url)}&referer=${encodeURIComponent(referer)}`
            : r.url;

          return {
            name: `Kirmalk`,
            title: `[${s.label || `سيرفر ${s.server}`}] ${r.title || 'HD'}`,
            url: streamUrl,
            behaviorHints: {
              notWebReady: false
            }
          };
        });
      }
      return [];
    } catch (_) {
      return [];
    }
  });

  const streamLists = await Promise.all(streamPromises);
  const playable = streamLists.flat();

  return playable;
}

module.exports = {
  manifest,
  getCatalog,
  getMeta,
  getStreamsFor,
  scrapeMovies,
  scrapeSeries,
  scrapeSearch,
  scrapeCategory,
  scrapeWatchServers,
  extractVid,
  extractEpisode,
  BASE,
  http
};
