const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const BASE_URL = 'https://kirmalk.com';
const agent = new https.Agent({ rejectUnauthorized: false });

const http = axios.create({
  baseURL: BASE_URL,
  headers: {
    'User-Agent': 'okhttp/4.9.3',
    'Accept-Language': 'ar,en;q=0.8',
    'Referer': BASE_URL
  },
  httpsAgent: agent,
  timeout: 8000
});

function cleanSeriesName(title) {
  if (!title) return '';
  return title
    .replace(/^مسلسل\s+/gi, '')
    .replace(/الحلقة\s*\d+.*$/gi, '')
    .replace(/حلقة\s*\d+.*$/gi, '')
    .replace(/الموسم\s*\d+.*$/gi, '')
    .replace(/الموسم\s*(الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر).*$/gi, '')
    .replace(/\b(HD|720p|1080p|FHD|مترجم|مدبلج|مدبلجة|مترجمة|كاملة|اون لاين|شاهد)\b/gi, '')
    .replace(/[\(\)\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scrape series from Kirmalk via all-series.php
 */
async function scrapeKirmalkSeries(maxPages = 3) {
  const seriesMap = new Map();

  for (let page = 1; page <= maxPages; page++) {
    const url = `/all-series.php?&page=${page}`;
    try {
      const res = await http.get(url);
      const $ = cheerio.load(res.data);

      $('.video-card').each((_, el) => {
        const titleLink = $(el).find('.video-title a');
        const cardLink = $(el).find('a.video-link, a[href*="watch.php?vid="]').first();
        const rawTitle = titleLink.text().replace(/\s+/g, ' ').trim() || cardLink.attr('title') || '';
        const href = cardLink.attr('href') || titleLink.attr('href');
        const img = $(el).find('img.thumbnail-image, img').attr('src') || $(el).find('img').attr('data-src');

        const m = href ? href.match(/vid=([a-z0-9]+)/i) : null;
        if (m && rawTitle) {
          const vid = m[1];
          const cleanName = cleanSeriesName(rawTitle);
          if (!cleanName) return;

          if (!seriesMap.has(cleanName)) {
            const seriesId = `km_s_${vid}`;
            seriesMap.set(cleanName, {
              id: seriesId,
              rawId: vid,
              name: 'مسلسل ' + cleanName,
              cleanName,
              href: href.startsWith('http') ? href : `${BASE_URL}${href}`,
              sampleVid: vid,
              poster: img || null,
              source: 'kirmalk',
              type: 'series'
            });
          }
        }
      });
    } catch (err) {
      console.warn(`[Kirmalk] Failed scraping series page ${page}: ${err.message}`);
    }
  }

  return Array.from(seriesMap.values());
}

/**
 * Scrape series from a specific Kirmalk category slug (e.g. serieseg4, seriessy5, series5l, turk14, rmadan27)
 */
async function scrapeKirmalkCategory(slug, maxPages = 10, categoryName = 'series') {
  const seriesMap = new Map();

  for (let page = 1; page <= maxPages; page++) {
    const url = `/category.php?cat=${slug}${page > 1 ? `&page=${page}` : ''}`;
    try {
      const res = await http.get(url);
      const $ = cheerio.load(res.data);

      $('.video-card').each((_, el) => {
        const titleLink = $(el).find('.video-title a');
        const cardLink = $(el).find('a.video-link, a[href*="watch.php?vid="]').first();
        const rawTitle = titleLink.text().replace(/\s+/g, ' ').trim() || cardLink.attr('title') || '';
        const href = cardLink.attr('href') || titleLink.attr('href');
        const img = $(el).find('img.thumbnail-image, img').attr('src') || $(el).find('img').attr('data-src');

        const m = href ? href.match(/vid=([a-z0-9]+)/i) : null;
        if (m && rawTitle) {
          const vid = m[1];
          const cleanName = cleanSeriesName(rawTitle);
          if (!cleanName) return;

          if (!seriesMap.has(cleanName)) {
            const seriesId = `km_s_${vid}`;
            seriesMap.set(cleanName, {
              id: seriesId,
              rawId: vid,
              name: 'مسلسل ' + cleanName,
              cleanName,
              href: href.startsWith('http') ? href : `${BASE_URL}${href}`,
              sampleVid: vid,
              poster: img || null,
              source: 'kirmalk',
              type: 'series',
              category: categoryName
            });
          }
        }
      });
    } catch (err) {
      console.warn(`[Kirmalk] Failed scraping cat ${slug} page ${page}: ${err.message}`);
    }
  }

  return Array.from(seriesMap.values());
}

/**
 * Scrape movies from Kirmalk via movies.php
 */
async function scrapeKirmalkMovies(maxPages = 3) {
  const movies = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `/movies.php?&page=${page}`;
    try {
      const res = await http.get(url);
      const $ = cheerio.load(res.data);

      $('.video-card').each((_, el) => {
        const titleLink = $(el).find('.video-title a');
        const cardLink = $(el).find('a.video-link, a[href*="watch.php?vid="]').first();
        const rawTitle = titleLink.text().replace(/\s+/g, ' ').trim() || cardLink.attr('title') || '';
        const href = cardLink.attr('href') || titleLink.attr('href');
        const img = $(el).find('img.thumbnail-image, img').attr('src') || $(el).find('img').attr('data-src');

        const m = href ? href.match(/vid=([a-z0-9]+)/i) : null;
        if (m && rawTitle) {
          // Strictly filter out any series episodes from movies
          if (/(مسلسل|الحلق[ةه]|حلق[ةه]\s*\d+|الموسم|موسم|الجزء\s*\d+|S\d+E\d+)/i.test(rawTitle)) {
            return;
          }

          const vid = m[1];
          const cleanTitle = rawTitle.replace(/\s+/g, ' ').trim();
          if (!movies.some(x => x.rawId === vid)) {
            movies.push({
              id: `km_m_${vid}`,
              rawId: vid,
              name: cleanTitle,
              href: href.startsWith('http') ? href : `${BASE_URL}${href}`,
              poster: img || null,
              source: 'kirmalk',
              type: 'movie'
            });
          }
        }
      });
    } catch (err) {
      console.warn(`[Kirmalk] Failed scraping movies page ${page}: ${err.message}`);
    }
  }

  return movies;
}

/**
 * Fetch all episodes for a Kirmalk series using its sample vid
 */
async function getKirmalkSeriesEpisodes(sampleVid) {
  try {
    const res = await http.get(`/view.php?vid=${sampleVid}`);
    const $ = cheerio.load(res.data);
    const episodes = [];

    $('.episodes-grid-classic a.classic-episode-item').each((idx, el) => {
      const href = $(el).attr('href');
      const m = href ? href.match(/vid=([a-z0-9]+)/i) : null;
      const epVid = m ? m[1] : null;
      const num = parseInt($(el).find('.episode-number-large').text().trim(), 10) || (idx + 1);
      if (epVid && !episodes.some(e => e.vid === epVid)) {
        episodes.push({
          episode: num,
          vid: epVid,
          title: `الحلقة ${num}`,
          href: `https://kirmalk.com/watch.php?vid=${epVid}`
        });
      }
    });

    if (episodes.length === 0) {
      episodes.push({
        episode: 1,
        vid: sampleVid,
        title: 'الحلقة 1',
        href: `https://kirmalk.com/watch.php?vid=${sampleVid}`
      });
    }

    episodes.sort((a, b) => a.episode - b.episode);
    return episodes;
  } catch (err) {
    console.warn(`[Kirmalk] Failed fetching episodes for vid ${sampleVid}: ${err.message}`);
    return [];
  }
}

/**
 * Extract servers for a Kirmalk video id
 */
async function extractKirmalkServers(vid) {
  const servers = [];
  try {
    const res = await http.get(`/view.php?vid=${vid}`);
    const $ = cheerio.load(res.data);
    $('#WatchServers [data-embed]').each((_, el) => {
      const embed = $(el).attr('data-embed');
      if (embed) {
        servers.push({
          server: parseInt($(el).attr('data-server') || '0', 10),
          label: $(el).find('span').text().trim() || $(el).text().trim() || 'سيرفر',
          embed,
          source: 'kirmalk'
        });
      }
    });

    if (servers.length === 0) {
      const iframeSrc = $('#Playerholder iframe, iframe').attr('src');
      if (iframeSrc && !iframeSrc.includes('challenge-platform')) {
        servers.push({ server: 1, label: 'سيرفر رئيسي', embed: iframeSrc, source: 'kirmalk' });
      }
    }
  } catch (_) {}

  return servers;
}

module.exports = {
  scrapeKirmalkSeries,
  scrapeKirmalkCategory,
  scrapeKirmalkMovies,
  getKirmalkSeriesEpisodes,
  extractKirmalkServers,
  BASE_URL
};
