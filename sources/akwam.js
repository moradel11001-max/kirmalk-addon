const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const { extractMediaUrls } = require('../resolver');

const BASE_URL = 'https://akwam.ss';
const agent = new https.Agent({ rejectUnauthorized: false });

const http = axios.create({
  baseURL: BASE_URL,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Referer': BASE_URL
  },
  httpsAgent: agent,
  timeout: 8000
});

/**
 * Scrape movies from Akwam by section
 * section 29 = عربي, 30 = أجنبي
 */
async function scrapeAkwamMovies(section = 29, maxPages = 2) {
  const movies = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `/movies?section=${section}&page=${page}`;
    try {
      const res = await http.get(url);
      const $ = cheerio.load(res.data);

      $('a[href*="/movie/"]').each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().replace(/\s+/g, ' ').trim();
        const box = $(el).closest('.entry-box, .widget-body, div[class*="col"]');
        const img = box.find('img').not('[src*="placeholder"]').attr('src') ||
                    box.find('img').attr('data-src') ||
                    box.find('img').attr('src');

        const m = href ? href.match(/\/movie\/(\d+)\/([^/?]+)/) : null;
        if (m && title && !title.includes('مشاهدة') && !title.includes('تحميل')) {
          const id = m[1];
          const fullHref = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          if (!movies.some(x => x.id === id)) {
            movies.push({
              id: `ak_m_${id}`,
              rawId: id,
              name: title,
              href: fullHref,
              poster: img || null,
              source: 'akwam',
              type: 'movie',
              section
            });
          }
        }
      });
    } catch (err) {
      console.warn(`[Akwam] Failed to scrape movies page ${page}: ${err.message}`);
    }
  }
  return movies;
}

/**
 * Scrape series from Akwam by section
 * section 29 = مسلسلات عربية, 32 = تركية, 30 = أجنبية, section=0&category=87 = رمضان
 */
async function scrapeAkwamSeries(section = 29, category = null, maxPages = 2) {
  const seriesList = [];
  for (let page = 1; page <= maxPages; page++) {
    let url = `/series?section=${section}&page=${page}`;
    if (category) {
      url = `/series?section=${section}&category=${category}&page=${page}`;
    }
    try {
      const res = await http.get(url);
      const $ = cheerio.load(res.data);

      $('a[href*="/series/"]').each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().replace(/\s+/g, ' ').trim();
        const box = $(el).closest('.entry-box, .widget-body, div[class*="col"]');
        const img = box.find('img').not('[src*="placeholder"]').attr('src') ||
                    box.find('img').attr('data-src') ||
                    box.find('img').attr('src');

        const m = href ? href.match(/\/series\/(\d+)\/([^/?]+)/) : null;
        if (m && title && !title.includes('مشاهدة') && !title.includes('تحميل')) {
          const id = m[1];
          const fullHref = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          if (!seriesList.some(x => x.id === id)) {
            seriesList.push({
              id: `ak_s_${id}`,
              rawId: id,
              name: title,
              href: fullHref,
              poster: img || null,
              source: 'akwam',
              type: 'series',
              section,
              category
            });
          }
        }
      });
    } catch (err) {
      console.warn(`[Akwam] Failed to scrape series page ${page}: ${err.message}`);
    }
  }
  return seriesList;
}

/**
 * Fetch all episodes of a series from Akwam
 */
async function getAkwamSeriesEpisodes(seriesUrl) {
  try {
    const res = await http.get(seriesUrl);
    const $ = cheerio.load(res.data);
    const episodes = [];

    $('a[href*="/episode/"]').each((idx, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const m = href ? href.match(/\/episode\/(\d+)\/([^/?]+)(?:\/([^/?]+))?/) : null;
      if (m) {
        const epId = m[1];
        const numMatch = text.match(/(?:الحلقة|حلقة)\s*(\d+)/i) || (m[3] && m[3].match(/(\d+)/));
        const epNum = numMatch ? parseInt(numMatch[1], 10) : (idx + 1);
        const fullHref = href.startsWith('http') ? href : `${BASE_URL}${href}`;

        if (!episodes.some(e => e.episode === epNum || e.id === epId)) {
          episodes.push({
            id: epId,
            episode: epNum,
            title: `الحلقة ${epNum}`,
            href: fullHref
          });
        }
      }
    });

    episodes.sort((a, b) => a.episode - b.episode);
    return episodes;
  } catch (err) {
    console.warn(`[Akwam] Failed to fetch episodes for ${seriesUrl}: ${err.message}`);
    return [];
  }
}

/**
 * Resolve direct video stream URLs from an Akwam movie or episode page
 */
async function resolveAkwamStreams(pageUrl) {
  try {
    const res = await http.get(pageUrl);
    const $ = cheerio.load(res.data);

    let watchUrl = $('a[href*="/watch/"]').first().attr('href');
    if (!watchUrl) {
      // Check if this page itself is already a watch page
      if (pageUrl.includes('/watch/')) {
        watchUrl = pageUrl;
      }
    }

    if (!watchUrl) return [];

    const fullWatchUrl = watchUrl.startsWith('http') ? watchUrl : `${BASE_URL}${watchUrl}`;
    const watchRes = await http.get(fullWatchUrl);
    const $w = cheerio.load(watchRes.data);

    const streams = [];

    // Check direct video sources
    $w('video source, source').each((_, el) => {
      const src = $w(el).attr('src');
      if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
        const is1080 = src.includes('1080p');
        const is720 = src.includes('720p');
        const label = is1080 ? '1080p' : (is720 ? '720p' : 'HD');
        streams.push({
          title: `[أكوام] سيرفر رئيسي (${label} MP4)`,
          url: src,
          referer: fullWatchUrl
        });
      }
    });

    // If none found, fallback to extractMediaUrls
    if (streams.length === 0) {
      const mediaUrls = extractMediaUrls(watchRes.data);
      for (const mUrl of mediaUrls) {
        const isHls = mUrl.includes('.m3u8');
        streams.push({
          title: `[أكوام] سيرفر بديل (${isHls ? 'HLS' : 'MP4'})`,
          url: mUrl,
          referer: fullWatchUrl
        });
      }
    }

    return streams;
  } catch (err) {
    console.warn(`[Akwam] Failed to resolve stream for ${pageUrl}: ${err.message}`);
    return [];
  }
}

module.exports = {
  scrapeAkwamMovies,
  scrapeAkwamSeries,
  getAkwamSeriesEpisodes,
  resolveAkwamStreams,
  BASE_URL
};
