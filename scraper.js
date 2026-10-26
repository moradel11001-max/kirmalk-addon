const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const cheerio = require('cheerio');
const { resolveEmbed } = require('./resolver');
const { resolveAkwamStreams } = require('./sources/akwam');
const { resolveWeCimaStreams } = require('./sources/wecima');

const BASE = 'https://kirmalk.com';
const CACHE_FILE = path.join(__dirname, 'cache.json');
const agent = new https.Agent({ rejectUnauthorized: false });

// ---------- HTTP Client ----------
const http = axios.create({
  headers: {
    'User-Agent': 'okhttp/4.9.3',
    'Accept-Language': 'ar,en;q=0.8',
    'Referer': BASE
  },
  httpsAgent: agent,
  timeout: 8000,
  maxRedirects: 5
});

// ---------- All Supported Catalogs ----------
const ALL_CATALOGS = [
  {
    type: "series",
    id: "kirmalk_latest_series",
    name: "🌟 أحدث المسلسلات (Latest Series)",
    extra: [{ name: "skip", isRequired: false }]
  },
  {
    type: "movie",
    id: "kirmalk_latest_movies",
    name: "🎬 أحدث الأفلام (Latest Movies)",
    extra: [{ name: "skip", isRequired: false }]
  },
  {
    type: "series",
    id: "kirmalk_ramadan",
    name: "🌙 مسلسلات رمضان (Ramadan)",
    extra: [{ name: "skip", isRequired: false }]
  },
  {
    type: "series",
    id: "kirmalk_turkish",
    name: "🇹🇷 مسلسلات تركية (Turkish Series)",
    extra: [{ name: "skip", isRequired: false }]
  },
  {
    type: "movie",
    id: "kirmalk_arabic_movies",
    name: "🇪🇬 أفلام عربي (Arabic Movies)",
    extra: [{ name: "skip", isRequired: false }]
  },
  {
    type: "series",
    id: "kirmalk_series",
    name: "📺 كل المسلسلات (All Series)",
    extra: [
      {
        name: "genre",
        options: ["الكل", "مسلسلات عربية", "مسلسلات تركية", "مسلسلات مصرية", "مسلسلات شامية", "مسلسلات خليجية", "مسلسلات رمضان", "مسلسلات أجنبية", "مسلسلات مدبلجة"],
        isRequired: false
      },
      { name: "search", isRequired: false },
      { name: "skip", isRequired: false }
    ]
  },
  {
    type: "movie",
    id: "kirmalk_movies",
    name: "🎥 كل الأفلام (All Movies)",
    extra: [
      {
        name: "genre",
        options: ["الكل", "أفلام عربي", "أفلام أجنبي", "أفلام تركية", "مسرحيات"],
        isRequired: false
      },
      { name: "search", isRequired: false },
      { name: "skip", isRequired: false }
    ]
  }
];

function getManifest(userConfig = null) {
  let catalogs = ALL_CATALOGS;
  if (userConfig && Array.isArray(userConfig.catalogs)) {
    const selected = new Set(userConfig.catalogs);
    catalogs = ALL_CATALOGS.filter(cat => {
      // Main catalogs always stay for search
      if (cat.id === 'kirmalk_series' || cat.id === 'kirmalk_movies') return true;
      return selected.has(cat.id);
    });
  }

  return {
    id: "org.kirmalk.addon",
    version: "1.2.0",
    name: "كرمالك TV (Kirmalk + Akwam + WeCima)",
    description: "أفلام ومسلسلات عربية وتركية وأجنبية بجودة عالية مع سيرفرات بديلة من كرمالك وأكوام ووي سيما",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    catalogs,
    idPrefixes: ["km_", "ak_", "wc_"],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

const manifest = getManifest();

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
    ...(initialData.foreign_series || []),
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

function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/^(مسلسل|فيلم|برنامج|سلسلة)\s+/i, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
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
async function getCatalog(type, catalogIdOrExtra = '', maybeExtra = {}, hostUrl = '', userConfig = null) {
  let catalogId = '';
  let extra = {};

  if (typeof catalogIdOrExtra === 'string' && (catalogIdOrExtra.startsWith('kirmalk_') || catalogIdOrExtra === '')) {
    catalogId = catalogIdOrExtra;
    extra = maybeExtra || {};
  } else if (typeof catalogIdOrExtra === 'object' && catalogIdOrExtra !== null) {
    extra = catalogIdOrExtra;
    hostUrl = typeof maybeExtra === 'string' ? maybeExtra : '';
  }

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

  // 1. For search: ALWAYS check purified consolidated catalog first for unified cards
  if (search) {
    const localMatches = getFallbackMetas(type, genre, search);
    if (localMatches.length > 0) {
      const paged = localMatches.slice(skip, skip + 50);
      const metas = (paged.length > 0 ? paged : (skip === 0 ? localMatches.slice(0, 50) : [])).map(m => ({
        ...m,
        poster: formatPoster(m.poster, hostUrl)
      }));
      return { metas };
    }
  }

  // 2. Specific Home Page Catalog Rows
  if (catalogId === 'kirmalk_latest_series') {
    const list = initialData.series || [];
    const paged = list.slice(skip, skip + 50);
    return { metas: paged.map(m => ({ ...m, poster: formatPoster(m.poster, hostUrl) })) };
  }

  if (catalogId === 'kirmalk_latest_movies') {
    const list = initialData.movies || [];
    const paged = list.slice(skip, skip + 50);
    return { metas: paged.map(m => ({ ...m, poster: formatPoster(m.poster, hostUrl) })) };
  }

  if (catalogId === 'kirmalk_ramadan') {
    const list = initialData.ramadan || [];
    const paged = list.slice(skip, skip + 50);
    return { metas: paged.map(m => ({ ...m, poster: formatPoster(m.poster, hostUrl) })) };
  }

  if (catalogId === 'kirmalk_turkish') {
    const list = initialData.turkish || [];
    const paged = list.slice(skip, skip + 50);
    return { metas: paged.map(m => ({ ...m, poster: formatPoster(m.poster, hostUrl) })) };
  }

  if (catalogId === 'kirmalk_arabic_movies') {
    const list = (initialData.movies || []).filter(m => !m.section || m.section === 29 || m.category === 'افلام-عربي' || m.source === 'kirmalk');
    const paged = list.slice(skip, skip + 50);
    return { metas: paged.map(m => ({ ...m, poster: formatPoster(m.poster, hostUrl) })) };
  }

  // 3. For series without search: ALWAYS serve from consolidated unified catalog for clean cards & instant response
  if (type === 'series' && !search) {
    const fallbackList = getFallbackMetas('series', genre, null);
    const paged = fallbackList.slice(skip, skip + 50);
    const metas = (paged.length > 0 ? paged : (skip === 0 ? fallbackList.slice(0, 50) : [])).map(m => ({
      ...m,
      poster: formatPoster(m.poster, hostUrl)
    }));
    return { metas };
  }

  // 4. For movies without search: ALWAYS serve from consolidated catalog for instant response
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
        } else if (genre === 'أفلام أجنبي' || genre === 'أفلام تركية') {
          metas = getFallbackMetas(type, genre, search).slice(skip, skip + 50);
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
        } else if (genre === 'مسلسلات أجنبية' || genre === 'مسلسلات مدبلجة') {
          metas = getFallbackMetas(type, genre, search).slice(skip, skip + 50);
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
    if (type === 'series' || id.startsWith('km_s_') || id.startsWith('wc_s_') || id.startsWith('ak_s_')) {
      const unified = (initialData.unifiedSeries && (
        initialData.unifiedSeries[id] ||
        initialData.unifiedSeries[cleanVid] ||
        initialData.unifiedSeries[`wc_s_${cleanVid}`] ||
        initialData.unifiedSeries[`ak_s_${cleanVid}`] ||
        initialData.unifiedSeries[`km_s_${cleanVid}`] ||
        Object.values(initialData.unifiedSeries).find(s => s.id === id || cleanId(s.id) === cleanVid)
      )) || null;
      if (unified) {
        const totalEps = (unified.videos || []).length;
        const metaSeriesId = id || unified.id;
        meta = {
          ...unified,
          id: metaSeriesId,
          poster: formatPoster(unified.poster, hostUrl),
          background: formatPoster(unified.background || unified.poster, hostUrl),
          videos: (unified.videos || []).map(v => {
            const epNum = parseInt(v.episode, 10) || 1;
            const relDate = v.released || new Date(Date.UTC(2024, 0, Math.min(28, epNum), 12, 0, 0)).toISOString();
            return {
              ...v,
              id: `${metaSeriesId}:1:${epNum}`,
              title: v.title || `الحلقة ${epNum}`,
              season: 1,
              episode: epNum,
              released: relDate
            };
          })
        };
        setCache(cacheKey, meta, 7200000);
        return meta;
      }
    }

    // 2. Check bundled movies & plays
    if (type === 'movie' || id.startsWith('km_m_') || id.startsWith('wc_m_') || id.startsWith('ak_m_')) {
      const allMovies = [
        ...(initialData.movies || []),
        ...(initialData.foreign_movies || []),
        ...(initialData.plays || [])
      ];
      const foundMovie = allMovies.find(m => m.id === id || cleanId(m.id) === cleanVid || m.rawId === cleanVid);
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
            id: `${id}:1:${epNum}`,
            vid: epVid,
            title: `الحلقة ${epNum}`,
            season: 1,
            episode: epNum
          });
        });

        if (videos.length === 0) {
          const epNum = extractEpisode(title) || 1;
          videos.push({
            id: `${id}:1:${epNum}`,
            vid: cleanVid,
            title: `الحلقة ${epNum}`,
            season: 1,
            episode: epNum
          });
        }

        videos.sort((a, b) => a.episode - b.episode);
        const totalEps = videos.length;
        videos.forEach(v => {
          v.released = new Date(Date.UTC(2024, 0, Math.min(28, v.episode), 12, 0, 0)).toISOString();
        });
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
          const totalEps = initialData.seriesMeta[cleanVid].length;
          meta.videos = initialData.seriesMeta[cleanVid].map(ep => {
            const epNum = parseInt(ep.episode, 10) || 1;
            return {
              id: `${id}:1:${epNum}`,
              vid: ep.vid,
              title: `الحلقة ${epNum}`,
              season: 1,
              episode: epNum,
              released: ep.released || new Date(Date.UTC(2024, 0, Math.min(28, epNum), 12, 0, 0)).toISOString()
            };
          });
        } else {
          const epNum = extractEpisode(meta.name) || 1;
          meta.videos = [{
            id: `${id}:1:${epNum}`,
            vid: cleanVid,
            title: `الحلقة ${epNum}`,
            season: 1,
            episode: epNum,
            released: new Date().toISOString()
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

  // 1. Check bundled servers cache first (filtering out fake watch.php embeds)!
  if (initialData.servers) {
    const cachedList = [
      initialData.servers[cleanVid],
      initialData.servers[decodedVid],
      initialData.servers[encodedVid],
      initialData.servers[`wc_m_${decodedVid}`],
      initialData.servers[`wc_s_${decodedVid}`],
      initialData.servers[`ak_m_${decodedVid}`],
      initialData.servers[`ak_s_${decodedVid}`]
    ];

    for (const cached of cachedList) {
      if (Array.isArray(cached) && cached.length > 0) {
        const validCached = cached.filter(s => s && s.embed && !s.embed.includes('watch.php'));
        if (validCached.length > 0) {
          return { servers: validCached };
        }
      }
    }
  }

  const servers = [];

  // Try view.php
  try {
    const { data } = await http.get(`${BASE}/view.php?vid=${cleanVid}`);
    const $ = cheerio.load(data);

    $('#WatchServers [data-embed]').each((_, el) => {
      let embed = $(el).attr('data-embed');
      if (embed) {
        if (embed.includes('<iframe') || embed.includes('<IFRAME')) {
          const m = embed.match(/src=["']([^"']+)["']/i);
          if (m) embed = m[1];
        }
        if (!embed.includes('watch.php')) {
          servers.push({
            server: parseInt($(el).attr('data-server') || '0', 10),
            label: $(el).find('span').text().trim() || $(el).text().trim() || `سيرفر ${$(el).attr('data-server') || ''}`,
            embed,
            source: 'kirmalk'
          });
        }
      }
    });

    if (servers.length === 0) {
      const iframeSrc = $('#Playerholder iframe, iframe').attr('src');
      if (iframeSrc && !iframeSrc.includes('challenge-platform') && !iframeSrc.includes('watch.php')) {
        servers.push({
          server: 1,
          label: 'سيرفر رئيسي',
          embed: iframeSrc,
          source: 'kirmalk'
        });
      }
    }
  } catch (err) {}

  // Try watch.php
  if (servers.length === 0) {
    try {
      const { data } = await http.get(`${BASE}/watch.php?vid=${cleanVid}`);
      const m = data.match(/"embedUrl":\s*"([^"]+)"/);
      if (m && m[1] && !m[1].includes('watch.php')) {
        servers.push({
          server: 1,
          label: 'سيرفر رئيسي',
          embed: m[1],
          source: 'kirmalk'
        });
      }
    } catch (_) {}
  }

  // Try embed.php
  if (servers.length === 0) {
    try {
      const { data } = await http.get(`${BASE}/embed.php?vid=${cleanVid}`);
      const $ = cheerio.load(data);
      const iframeSrc = $('iframe').attr('src');
      if (iframeSrc && !iframeSrc.includes('challenge-platform') && !iframeSrc.includes('watch.php')) {
        servers.push({
          server: 1,
          label: 'سيرفر رئيسي',
          embed: iframeSrc,
          source: 'kirmalk'
        });
      }
    } catch (_) {}
  }

  return { servers };
}

// ---------- High-Level getStreamsFor for Stremio ----------
async function getStreamsFor(baseId, season, episode, hostUrl = '', userConfig = null) {
  let targetVid = null;
  let rawServers = [];
  let seriesId = '';
  let epNum = 1;
  let isSeries = false;

  if (typeof baseId === 'string' && baseId.includes(':')) {
    isSeries = true;
    const parts = baseId.split(':');
    seriesId = parts[0];
    epNum = parseInt(parts[2], 10) || 1;
    if (parts.length >= 4 && parts[3]) {
      targetVid = parts[3];
    }
  } else if (season && episode) {
    isSeries = true;
    seriesId = baseId;
    epNum = parseInt(episode, 10) || 1;
  } else {
    seriesId = baseId;
    targetVid = cleanId(baseId);
  }

  if (isSeries) {
    const cleanBase = cleanId(seriesId);
    const candidateVids = new Set();
    if (targetVid) candidateVids.add(targetVid);

    // 1. Locate primary series in unifiedSeries
    let mainSeries = null;
    if (initialData.unifiedSeries) {
      mainSeries = initialData.unifiedSeries[seriesId] ||
                   initialData.unifiedSeries[cleanBase] ||
                   initialData.unifiedSeries[`km_s_${cleanBase}`] ||
                   initialData.unifiedSeries[`ak_s_${cleanBase}`] ||
                   initialData.unifiedSeries[`wc_s_${cleanBase}`] ||
                   Object.values(initialData.unifiedSeries).find(x => x.id === seriesId || cleanId(x.id) === cleanBase);
    }

    const seriesTitle = mainSeries ? (mainSeries.name || mainSeries.title) : '';
    const normTargetTitle = normalizeTitle(seriesTitle);

    // 2. Multi-source series aggregation: match other entries with similar title
    const matchedSeriesList = [];
    if (mainSeries) matchedSeriesList.push(mainSeries);

    if (normTargetTitle && initialData.unifiedSeries) {
      for (const [k, sObj] of Object.entries(initialData.unifiedSeries)) {
        if (sObj && sObj !== mainSeries) {
          const sNorm = normalizeTitle(sObj.name || sObj.title);
          if (sNorm && (sNorm === normTargetTitle || sNorm.includes(normTargetTitle) || normTargetTitle.includes(sNorm))) {
            matchedSeriesList.push(sObj);
          }
        }
      }
    }

    // 3. Collect episode data and servers across all matched series variants
    for (const sObj of matchedSeriesList) {
      if (!sObj.videos) continue;
      const eps = sObj.videos.filter(v => v.episode === epNum || (targetVid && v.vid === targetVid));
      for (const ep of eps) {
        if (ep.vid) candidateVids.add(ep.vid);
        if (ep.href) {
          if (ep.href.includes('akwam')) {
            rawServers.push({ server: 1, label: 'سيرفر أكوام (MP4)', embed: ep.href, source: 'akwam' });
          } else if (ep.href.includes('wecima')) {
            rawServers.push({ server: 1, label: 'سيرفر وي سيما (HD HLS)', embed: ep.href, source: 'wecima' });
          } else if (ep.href.includes('watch.php') || ep.href.includes('vid=')) {
            const m = ep.href.match(/vid=([a-zA-Z0-9_-]+)/);
            if (m) candidateVids.add(m[1]);
          } else {
            rawServers.push({ server: 1, label: 'سيرفر رئيسي', embed: ep.href, source: 'kirmalk' });
          }
        }
      }
    }

    // 4. Also check seriesMeta for cleanBase and any candidateVids
    if (initialData.seriesMeta) {
      const metaKeys = [cleanBase, ...Array.from(candidateVids)];
      for (const k of metaKeys) {
        if (initialData.seriesMeta[k]) {
          const ep = initialData.seriesMeta[k].find(v => v.episode === epNum);
          if (ep) {
            if (ep.vid) candidateVids.add(ep.vid);
            if (ep.href) {
              if (ep.href.includes('akwam')) {
                rawServers.push({ server: 1, label: 'سيرفر أكوام (MP4)', embed: ep.href, source: 'akwam' });
              } else if (ep.href.includes('wecima')) {
                rawServers.push({ server: 1, label: 'سيرفر وي سيما (HD HLS)', embed: ep.href, source: 'wecima' });
              } else if (ep.href.includes('watch.php') || ep.href.includes('vid=')) {
                const m = ep.href.match(/vid=([a-zA-Z0-9_-]+)/);
                if (m) candidateVids.add(m[1]);
              } else {
                rawServers.push({ server: 1, label: 'سيرفر رئيسي', embed: ep.href, source: 'kirmalk' });
              }
            }
          }
        }
      }
    }

    // 5. Aggregate all servers bundled in initialData.servers for all candidate vids
    if (initialData.servers) {
      for (const vid of candidateVids) {
        const cached = initialData.servers[vid] || initialData.servers[cleanId(vid)];
        if (Array.isArray(cached)) {
          for (const s of cached) {
            if (s && s.embed && !s.embed.includes('watch.php')) {
              rawServers.push(s);
            }
          }
        }
      }
    }

    // 6. If we have fewer than 2 servers, attempt live scrape of watch servers
    if (rawServers.length < 2 && candidateVids.size > 0) {
      for (const vid of candidateVids) {
        try {
          const scraped = await scrapeWatchServers(vid);
          if (scraped && scraped.servers && scraped.servers.length > 0) {
            for (const s of scraped.servers) {
              if (s && s.embed && !s.embed.includes('watch.php')) {
                rawServers.push(s);
              }
            }
          }
        } catch (_) {}
      }
    }

    if (!targetVid && candidateVids.size > 0) {
      targetVid = Array.from(candidateVids)[0];
    }
  } else {
    // Media is a Movie
    const cleanBase = cleanId(baseId);
    const candidateVids = new Set([cleanBase]);
    if (targetVid) candidateVids.add(targetVid);

    let mainMovie = null;
    if (initialData.movies) {
      mainMovie = initialData.movies.find(m => m.id === baseId || cleanId(m.id) === cleanBase || m.rawId === cleanBase);
    }
    const movieTitle = mainMovie ? (mainMovie.name || mainMovie.title) : '';
    const normMovieTitle = normalizeTitle(movieTitle);

    const matchedMovies = [];
    if (mainMovie) matchedMovies.push(mainMovie);
    if (normMovieTitle && initialData.movies) {
      for (const m of initialData.movies) {
        if (m !== mainMovie) {
          const mNorm = normalizeTitle(m.name || m.title);
          if (mNorm && (mNorm === normMovieTitle || mNorm.includes(normMovieTitle) || normMovieTitle.includes(mNorm))) {
            matchedMovies.push(m);
          }
        }
      }
    }

    for (const m of matchedMovies) {
      if (m.rawId) candidateVids.add(m.rawId);
      if (m.href) {
        if (m.source === 'akwam' || m.href.includes('akwam')) {
          rawServers.push({ server: 1, label: 'سيرفر أكوام (1080p MP4)', embed: m.href, source: 'akwam' });
        } else if (m.source === 'wecima' || m.href.includes('wecima')) {
          rawServers.push({ server: 1, label: 'سيرفر وي سيما (HD HLS)', embed: m.href, source: 'wecima' });
        } else if (m.href.includes('watch.php') || m.href.includes('vid=')) {
          const match = m.href.match(/vid=([a-zA-Z0-9_-]+)/);
          if (match) candidateVids.add(match[1]);
        } else {
          rawServers.push({ server: 1, label: 'سيرفر رئيسي', embed: m.href, source: 'kirmalk' });
        }
      }
    }

    // Pull from initialData.servers
    if (initialData.servers) {
      for (const vid of candidateVids) {
        const cached = initialData.servers[vid] || initialData.servers[cleanId(vid)];
        if (Array.isArray(cached)) {
          for (const s of cached) {
            if (s && s.embed && !s.embed.includes('watch.php')) {
              rawServers.push(s);
            }
          }
        }
      }
    }

    // Scrape if needed
    if (rawServers.length < 2) {
      for (const vid of candidateVids) {
        try {
          const scraped = await scrapeWatchServers(vid);
          if (scraped && scraped.servers && scraped.servers.length > 0) {
            for (const s of scraped.servers) {
              if (s && s.embed && !s.embed.includes('watch.php')) {
                rawServers.push(s);
              }
            }
          }
        } catch (_) {}
      }
    }
  }

  if (!rawServers || rawServers.length === 0) return [];

  // Deduplicate servers and extract iframe embeds if wrapped
  const seenEmbeds = new Set();
  const cleanedServers = [];

  for (const s of rawServers) {
    let embed = s.embed;
    if (!embed) continue;
    if (embed.includes('<iframe') || embed.includes('<IFRAME')) {
      const m = embed.match(/src=["']([^"']+)["']/i);
      if (m) embed = m[1];
    }
    if (!embed || embed.includes('watch.php') || seenEmbeds.has(embed)) continue;
    seenEmbeds.add(embed);

    let sSource = s.source;
    if (embed.includes('akwam')) sSource = 'akwam';
    else if (embed.includes('wecima')) sSource = 'wecima';
    else if (!sSource) sSource = 'kirmalk';

    cleanedServers.push({
      ...s,
      embed,
      source: sSource
    });
  }

  if (cleanedServers.length === 0) return [];

  const safeSeriesKey = (seriesId || cleanId(baseId) || 'media').replace(/[^a-zA-Z0-9_-]/g, '_');
  const bingeGroupDirect = `${safeSeriesKey}-direct`;
  const bingeGroupProxy = `${safeSeriesKey}-proxy`;

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
        const serverStreams = [];

        for (const r of resolved) {
          let referer = r.referer || s.embed || 'https://kirmalk.com/';
          if (sSource === 'akwam') {
            referer = 'https://akwam.ss/';
          } else if (sSource === 'wecima') {
            referer = 'https://wecima.onl/';
          } else {
            try {
              if (referer && referer.startsWith('http')) {
                referer = new URL(referer).origin + '/';
              }
            } catch (_) {
              referer = 'https://kirmalk.com/';
            }
          }

          const isHls = r.url.includes('.m3u8') || (r.title && r.title.includes('HLS'));

          let sourceName = 'كرمالك';
          if (sSource === 'akwam') sourceName = 'أكوام';
          else if (sSource === 'wecima') sourceName = 'وي سيما';

          let serverTitle = r.title || 'HD';
          if (s.label && !serverTitle.includes(s.label)) {
            serverTitle = `[${s.label}] ${serverTitle}`;
          }

          // 1. Direct Stream with proxyHeaders (Fastest & Native for Android TV ExoPlayer)
          serverStreams.push({
            name: sourceName,
            title: `${serverTitle} ⚡ مباشر (ExoPlayer TV)`,
            url: r.url,
            behaviorHints: {
              notWebReady: false,
              bingeGroup: bingeGroupDirect,
              proxyHeaders: {
                request: {
                  'User-Agent': 'okhttp/4.9.3',
                  'Referer': referer
                }
              }
            }
          });

          // 2. Backup Proxied Stream (For Web or when direct CDN is restricted)
          if (hostUrl) {
            const proxyPath = isHls ? '/proxy/stream.m3u8' : '/proxy/video.mp4';
            serverStreams.push({
              name: sourceName,
              title: `${serverTitle} 🌐 بروكسي احتياطي (Proxy)`,
              url: `${hostUrl}${proxyPath}?url=${encodeURIComponent(r.url)}&referer=${encodeURIComponent(referer)}`,
              behaviorHints: {
                notWebReady: false,
                bingeGroup: bingeGroupProxy,
                proxyHeaders: {
                  request: {
                    'User-Agent': 'okhttp/4.9.3',
                    'Referer': referer
                  }
                }
              }
            });
          }
        }
        return serverStreams;
      }
      return [];
    } catch (_) {
      return [];
    }
  });

  const streamLists = await Promise.all(streamPromises);
  let playable = streamLists.flat();

  // If userConfig requested data saver mode, prioritize 720p and 480p
  if (userConfig && userConfig.quality === 'saver') {
    playable.sort((a, b) => {
      const aIsFhd = (a.title || '').includes('1080p') || (a.title || '').includes('FHD');
      const bIsFhd = (b.title || '').includes('1080p') || (b.title || '').includes('FHD');
      return (aIsFhd ? 1 : 0) - (bIsFhd ? 1 : 0);
    });
  }

  return playable;
}

module.exports = {
  manifest,
  getManifest,
  ALL_CATALOGS,
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
