const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { resolveEmbed } = require('./resolver');
const { resolveAkwamStreams } = require('./sources/akwam');
const { resolveWeCimaStreams } = require('./sources/wecima');

const BASE = 'https://kirmalk.com';
const CACHE_FILE = path.join(__dirname, 'cache.json');

// ---------- HTTP Client ----------
const http = axios.create({
  headers: {
    'User-Agent': 'okhttp/4.9.3',
    'Accept-Language': 'ar,en;q=0.8',
    'Referer': BASE
  },
  timeout: 8000,
  maxRedirects: 5
});

// ---------- Stremio Manifest ----------
const manifest = {
  id: "org.kirmalk.addon",
  version: "1.1.0",
  name: "كرمالك TV (Kirmalk + Akwam + WeCima)",
  description: "أفلام ومسلسلات عربية وتركية وأجنبية بجودة عالية مع سيرفرات بديلة من كرمالك وأكوام ووي سيما",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "kirmalk_movies",
      name: "الأفلام (Movies)",
      extra: [
        {
          name: "genre",
          options: ["الكل", "أفلام عربي", "أفلام أجنبي", "أفلام تركية", "مسرحيات"],
          isRequired: false
        },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "kirmalk_series",
      name: "المسلسلات (Series)",
      extra: [
        {
          name: "genre",
          options: ["الكل", "مسلسلات عربية", "مسلسلات تركية", "مسلسلات مصرية", "مسلسلات شامية", "مسلسلات خليجية", "مسلسلات رمضان", "مسلسلات أجنبية", "مسلسلات مدبلجة"],
          isRequired: false
        },
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ],
  idPrefixes: ["km_", "ak_", "wc_"]
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
      ...(initialData.plays || []),
      ...(initialData.foreign_movies || []),
      ...(initialData.foreign_series || []),
      ...(initialData.dubbed_series || [])
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
    } else if (genre === 'أفلام أجنبي') {
      return initialData.foreign_movies || [];
    } else if (genre === 'أفلام تركية') {
      return (initialData.movies || []).filter(m => m.category === 'افلام-تركية' || /تركي/i.test(m.name));
    } else if (genre === 'أفلام عربي') {
      return (initialData.movies || []).filter(m => !m.section || m.section === 29 || m.category === 'افلام-عربي' || m.source === 'kirmalk');
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
  } else if (genre === 'مسلسلات أجنبية') {
    return initialData.foreign_series || [];
  } else if (genre === 'مسلسلات مدبلجة') {
    return initialData.dubbed_series || [];
  } else if (genre === 'مسلسلات عربية') {
    const combinedArabic = [
      ...(initialData.egyptian || []),
      ...(initialData.syrian || []),
      ...(initialData.gulf || []),
      ...(initialData.ramadan || []),
      ...(initialData.series || []).filter(s => s.section === 29 || s.category === 'مسلسلات-عربي')
    ];
    const seen = new Set();
    const list = [];
    for (const item of combinedArabic) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        list.push(item);
      }
    }
    return list;
  }

  // General series: combine all series lists
  const combined = [
    ...(initialData.series || []),
    ...(initialData.turkish || []),
    ...(initialData.egyptian || []),
    ...(initialData.syrian || []),
    ...(initialData.gulf || []),
    ...(initialData.ramadan || []),
    ...(initialData.dubbed_series || [])
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
  let cleaned = id.replace(/^(km|ak|wc)_[ms]_?/, '').replace(/^(km|ak|wc)_/, '');
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch (_) {}
  return cleaned;
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

  // For series without search: ALWAYS serve from consolidated unified catalog for clean cards & instant response
  if (type === 'series' && !search) {
    const fallbackList = getFallbackMetas('series', genre, null);
    const paged = fallbackList.slice(skip, skip + 50);
    const metas = (paged.length > 0 ? paged : (skip === 0 ? fallbackList.slice(0, 50) : [])).map(m => ({
      ...m,
      poster: formatPoster(m.poster, hostUrl)
    }));
    return { metas };
  }

  // For movies without search: ALWAYS serve from consolidated catalog for instant response
  if (type === 'movie' && !search) {
    const fallbackList = getFallbackMetas('movie', genre, null);
    const paged = fallbackList.slice(skip, skip + 50);
    const metas = (paged.length > 0 ? paged : (skip === 0 ? fallbackList.slice(0, 50) : [])).map(m => ({
      ...m,
      poster: formatPoster(m.poster, hostUrl)
    }));
    return { metas };
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

    // 1. Check bundled unifiedSeries first!
    if (type === 'series' || id.startsWith('km_s_')) {
      const unified = (initialData.unifiedSeries && (initialData.unifiedSeries[id] || initialData.unifiedSeries[cleanVid])) || null;
      if (unified) {
        meta = {
          ...unified,
          poster: formatPoster(unified.poster, hostUrl),
          background: formatPoster(unified.background || unified.poster, hostUrl),
          videos: (unified.videos || []).map(v => ({
            ...v,
            id: `${unified.id}:1:${v.episode}:${v.vid}`
          }))
        };
        setCache(cacheKey, meta, 7200000);
        return meta;
      }
    }

    // 2. Check bundled movies & plays
    if (type === 'movie' || id.startsWith('km_m_')) {
      const foundMovie = [...(initialData.movies || []), ...(initialData.plays || [])].find(m => m.id === id || cleanId(m.id) === cleanVid);
      if (foundMovie) {
        meta = {
          id: foundMovie.id,
          type: 'movie',
          name: foundMovie.name,
          poster: formatPoster(foundMovie.poster, hostUrl),
          background: formatPoster(foundMovie.poster, hostUrl),
          description: foundMovie.description || foundMovie.name,
          genres: foundMovie.genres || ['أفلام']
        };
        setCache(cacheKey, meta, 7200000);
        return meta;
      }
    }

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
        if (initialData.seriesMeta && initialData.seriesMeta[cleanVid]) {
          meta.videos = initialData.seriesMeta[cleanVid].map(ep => ({
            id: `${id}:1:${ep.episode}:${ep.vid}`,
            title: `الحلقة ${ep.episode}`,
            season: 1,
            episode: ep.episode
          }));
        } else {
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
  }

  return {
    ...meta,
    poster: formatPoster(meta.poster, hostUrl),
    background: formatPoster(meta.background, hostUrl)
  };
}

// ---------- Scraping Watch Servers (view.php / watch.php / embed.php) ----------
async function scrapeWatchServers(vid) {
  const cleanVid = cleanId(vid);
  let decodedVid = cleanVid;
  try { decodedVid = decodeURIComponent(cleanVid); } catch (_) {}
  let encodedVid = encodeURIComponent(decodedVid);

  // 1. Check bundled servers cache first!
  if (initialData.servers) {
    if (initialData.servers[cleanVid]?.length) return { servers: initialData.servers[cleanVid] };
    if (initialData.servers[decodedVid]?.length) return { servers: initialData.servers[decodedVid] };
    if (initialData.servers[encodedVid]?.length) return { servers: initialData.servers[encodedVid] };
    if (initialData.servers[`wc_m_${decodedVid}`]?.length) return { servers: initialData.servers[`wc_m_${decodedVid}`] };
    if (initialData.servers[`wc_s_${decodedVid}`]?.length) return { servers: initialData.servers[`wc_s_${decodedVid}`] };
    if (initialData.servers[`ak_m_${decodedVid}`]?.length) return { servers: initialData.servers[`ak_m_${decodedVid}`] };
    if (initialData.servers[`ak_s_${decodedVid}`]?.length) return { servers: initialData.servers[`ak_s_${decodedVid}`] };
  }

  const servers = [];

  // Try view.php
  try {
    const { data } = await http.get(`${BASE}/view.php?vid=${cleanVid}`);
    const $ = cheerio.load(data);

    $('#WatchServers [data-embed]').each((_, el) => {
      const embed = $(el).attr('data-embed');
      if (embed) {
        servers.push({
          server: parseInt($(el).attr('data-server') || '0', 10),
          label: $(el).find('span').text().trim() || $(el).text().trim() || `سيرفر ${$(el).attr('data-server') || ''}`,
          embed
        });
      }
    });

    if (servers.length === 0) {
      const iframeSrc = $('#Playerholder iframe, iframe').attr('src');
      if (iframeSrc && !iframeSrc.includes('challenge-platform')) {
        servers.push({
          server: 1,
          label: 'سيرفر رئيسي',
          embed: iframeSrc
        });
      }
    }
  } catch (err) {}

  // Try watch.php
  if (servers.length === 0) {
    try {
      const { data } = await http.get(`${BASE}/watch.php?vid=${cleanVid}`);
      const m = data.match(/"embedUrl":\s*"([^"]+)"/);
      if (m && m[1]) {
        servers.push({
          server: 1,
          label: 'سيرفر رئيسي',
          embed: m[1]
        });
      } else {
        const $ = cheerio.load(data);
        const link = $('link[itemprop="embedUrl"]').attr('href');
        if (link) {
          servers.push({
            server: 1,
            label: 'سيرفر رئيسي',
            embed: link
          });
        }
      }
    } catch (_) {}
  }

  // Try embed.php
  if (servers.length === 0) {
    try {
      const { data } = await http.get(`${BASE}/embed.php?vid=${cleanVid}`);
      const $ = cheerio.load(data);
      const iframeSrc = $('iframe').attr('src');
      if (iframeSrc && !iframeSrc.includes('challenge-platform')) {
        servers.push({
          server: 1,
          label: 'سيرفر رئيسي',
          embed: iframeSrc
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
      const cleanBase = cleanId(parts[0]);

      if (initialData.unifiedSeries && (initialData.unifiedSeries[cleanBase] || initialData.unifiedSeries[`km_s_${cleanBase}`])) {
        const s = initialData.unifiedSeries[cleanBase] || initialData.unifiedSeries[`km_s_${cleanBase}`];
        const ep = s.videos?.find(v => v.episode === epNum);
        if (ep && ep.vid) targetVid = ep.vid;
      }

      if (!targetVid && initialData.seriesMeta && initialData.seriesMeta[cleanBase]) {
        const ep = initialData.seriesMeta[cleanBase].find(v => v.episode === epNum);
        if (ep && ep.vid) targetVid = ep.vid;
      }

      if (!targetVid) {
        targetVid = cleanBase;
      }
    }
  } else if (season && episode) {
    const epNum = parseInt(episode, 10);
    const cleanBase = cleanId(baseId);

    if (initialData.unifiedSeries && (initialData.unifiedSeries[cleanBase] || initialData.unifiedSeries[`km_s_${cleanBase}`])) {
      const s = initialData.unifiedSeries[cleanBase] || initialData.unifiedSeries[`km_s_${cleanBase}`];
      const ep = s.videos?.find(v => v.episode === epNum);
      if (ep && ep.vid) targetVid = ep.vid;
    }

    if (!targetVid && initialData.seriesMeta && initialData.seriesMeta[cleanBase]) {
      const ep = initialData.seriesMeta[cleanBase].find(v => v.episode === epNum);
      if (ep && ep.vid) targetVid = ep.vid;
    }

    if (!targetVid) {
      targetVid = cleanBase;
    }
  } else {
    targetVid = cleanId(baseId);
  }

  if (!targetVid) return [];

  let { servers } = await scrapeWatchServers(targetVid);

  // Fallback: check if baseId matches a movie directly in initialData.movies
  if ((!servers || servers.length === 0) && initialData.movies) {
    const movie = initialData.movies.find(m => m.id === baseId || cleanId(m.id) === targetVid);
    if (movie && movie.href) {
      if (movie.source === 'wecima') {
        servers = [{ server: 1, label: 'سيرفر وي سيما (HD HLS)', embed: movie.href, source: 'wecima' }];
      } else if (movie.source === 'akwam') {
        servers = [{ server: 1, label: 'سيرفر أكوام (1080p MP4)', embed: movie.href, source: 'akwam' }];
      }
    }
  }

  if (!servers || servers.length === 0) return [];

  // Extract raw embed URL if wrapped inside iframe HTML tag
  const cleanedServers = servers.map(s => {
    let embed = s.embed;
    if (embed && (embed.includes('<iframe') || embed.includes('<IFRAME'))) {
      const m = embed.match(/src=["']([^"']+)["']/i);
      if (m) embed = m[1];
    }
    return { ...s, embed };
  });

  const streamPromises = cleanedServers.map(async (s) => {
    try {
      let resolved = [];
      const sSource = s.source || (s.embed && s.embed.includes('akwam') ? 'akwam' : (s.embed && s.embed.includes('wecima') ? 'wecima' : 'kirmalk'));

      if (sSource === 'akwam') {
        resolved = await resolveAkwamStreams(s.embed);
      } else if (sSource === 'wecima') {
        resolved = await resolveWeCimaStreams(s.embed);
      } else {
        resolved = await resolveEmbed(s.embed);
      }

      if (resolved && resolved.length > 0) {
        return resolved.map(r => {
          const referer = r.referer || s.embed;
          const isHls = r.url.includes('.m3u8') || (r.title && r.title.includes('HLS'));
          const endpoint = isHls ? '/proxy/stream.m3u8' : '/proxy/video.mp4';
          const streamUrl = hostUrl
            ? `${hostUrl}${endpoint}?url=${encodeURIComponent(r.url)}&referer=${encodeURIComponent(referer)}`
            : r.url;

          let sourceName = 'كرمالك';
          if (sSource === 'akwam') sourceName = 'أكوام';
          else if (sSource === 'wecima') sourceName = 'وي سيما';

          let serverTitle = r.title || 'HD';
          if (s.label && !serverTitle.includes(s.label)) {
            serverTitle = `[${s.label}] ${serverTitle}`;
          }

          return {
            name: sourceName,
            title: serverTitle,
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
