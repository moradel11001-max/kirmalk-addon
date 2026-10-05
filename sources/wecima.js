const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const { extractMediaUrls } = require('../resolver');

const BASE_URL = 'https://wecima.onl';
const agent = new https.Agent({ rejectUnauthorized: false });

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': BASE_URL
};

/**
 * Scrape movies from WeCima by category
 * Categories: 'افلام-عربي', 'افلام-اجنبي', 'افلام-تركية'
 */
async function scrapeWeCimaMovies(category = 'افلام-عربي', maxPages = 2) {
  const movies = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE_URL}/category/${encodeURIComponent(category)}${page > 1 ? `?page=${page}` : ''}`;
    try {
      const res = await axios.get(url, { headers, httpsAgent: agent, timeout: 8000 });
      const $ = cheerio.load(res.data);

      $('div[class*="col"]').each((_, el) => {
        const a = $(el).find('a[href*="/film/"]');
        if (!a.length) return;

        const href = a.attr('href');
        let title = a.attr('title') || $(el).find('.Title').text() || a.text();
        title = title.replace(/\s+/g, ' ').trim();
        // Clean off leading 'افلام عربي' or 'افلام اجنبي' from title attribute
        title = title.replace(/^(افلام|أفلام)\s+(عربي|اجنبي|تركي|تركية|هندي)\s+/i, '').trim();

        const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || $(el).find('span.BG').attr('data-bg');

        const m = href ? href.match(/\/film\/([^/?#]+)/) : null;
        if (m && title && !movies.some(x => x.href === href)) {
          const slug = m[1];
          movies.push({
            id: `wc_m_${slug}`,
            rawId: slug,
            name: title,
            href,
            poster: img || null,
            source: 'wecima',
            type: 'movie',
            category
          });
        }
      });
    } catch (err) {
      console.warn(`[WeCima] Failed to scrape movies page ${page}: ${err.message}`);
    }
  }
  return movies;
}

/**
 * Scrape series from WeCima by category
 * Categories: 'مسلسلات-عربي', 'مسلسلات-تركية', 'مسلسلات-مدبلجة', 'مسلسلات-اجنبي'
 */
async function scrapeWeCimaSeries(category = 'مسلسلات-عربي', maxPages = 2) {
  const seriesMap = new Map();

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE_URL}/category/${encodeURIComponent(category)}${page > 1 ? `?page=${page}` : ''}`;
    try {
      const res = await axios.get(url, { headers, httpsAgent: agent, timeout: 8000 });
      const $ = cheerio.load(res.data);

      $('div[class*="col"]').each((_, el) => {
        const a = $(el).find('a[href*="/episode/"], a[href*="/series/"]');
        if (!a.length) return;

        const href = a.attr('href');
        let rawTitle = a.attr('title') || $(el).find('.Title').text() || a.text();
        rawTitle = rawTitle.replace(/\s+/g, ' ').trim();

        // Extract series title by stripping episode numbers
        let cleanTitle = rawTitle
          .replace(/^الحلقة\s*\d+\s*/i, '')
          .replace(/^(مسلسلات|مسلسل)\s+(عربي|تركي|تركية|اجنبي|مدبلجة)\s+/i, '')
          .replace(/الحلقة\s*(\d+|[^\s]+).*/i, '')
          .trim();

        const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || $(el).find('span.BG').attr('data-bg');

        // Extract series slug from episode url or title
        // e.g., /episode/مسلسل-سندس-3-الحلقة-22 -> مسلسل-سندس
        let seriesSlug = cleanTitle.replace(/\s+/g, '-');
        if (href && href.includes('/series/')) {
          const sm = href.match(/\/series\/([^/?#]+)/);
          if (sm) seriesSlug = sm[1];
        }

        if (cleanTitle && !seriesMap.has(seriesSlug)) {
          const seriesUrl = `${BASE_URL}/series/${encodeURIComponent(seriesSlug)}`;
          seriesMap.set(seriesSlug, {
            id: `wc_s_${seriesSlug}`,
            rawId: seriesSlug,
            name: cleanTitle,
            href: seriesUrl,
            sampleEpHref: href,
            poster: img || null,
            source: 'wecima',
            type: 'series',
            category
          });
        }
      });
    } catch (err) {
      console.warn(`[WeCima] Failed to scrape series page ${page}: ${err.message}`);
    }
  }

  return Array.from(seriesMap.values());
}

/**
 * Fetch all episodes for a WeCima series
 */
async function getWeCimaSeriesEpisodes(seriesUrl, sampleEpUrl = null) {
  const episodes = [];
  const epUrlsSeen = new Set();

  async function parseEpList(pageUrl) {
    try {
      const res = await axios.get(encodeURI(pageUrl), { headers, httpsAgent: agent, timeout: 8000 });
      const $ = cheerio.load(res.data);

      $('a[href*="/episode/"]').each((idx, el) => {
        const epHref = $(el).attr('href');
        const epText = $(el).text().replace(/\s+/g, ' ').trim();
        if (epHref && !epUrlsSeen.has(epHref)) {
          epUrlsSeen.add(epHref);
          const numMatch = epText.match(/(?:الحلقة|حلقة)\s*(\d+)/i) || epHref.match(/الحلقة-(\d+)/);
          const epNum = numMatch ? parseInt(numMatch[1], 10) : (episodes.length + 1);

          episodes.push({
            id: epHref,
            episode: epNum,
            title: `الحلقة ${epNum}`,
            href: epHref
          });
        }
      });

      // Check if there are seasons links
      const seasons = [];
      $('a[href*="/season/"]').each((_, sEl) => {
        const sHref = $(sEl).attr('href');
        if (sHref) {
          const fullSHref = sHref.startsWith('http') ? sHref : `${BASE_URL}${sHref}`;
          seasons.push(fullSHref);
        }
      });

      return seasons;
    } catch (err) {
      return [];
    }
  }

  // 1. Try series page
  const seasons = await parseEpList(seriesUrl);

  // If seasons found, fetch episodes from seasons
  for (const sUrl of seasons) {
    await parseEpList(sUrl);
  }

  // 2. If no episodes found, try from sample episode page
  if (episodes.length === 0 && sampleEpUrl) {
    await parseEpList(sampleEpUrl);
  }

  episodes.sort((a, b) => a.episode - b.episode);
  return episodes;
}

/**
 * Resolve direct video stream URLs from a WeCima movie or episode page
 */
async function resolveWeCimaStreams(pageUrl) {
  try {
    let watchUrl = pageUrl;
    let cookieHeader = '';

    // If it's a film or episode page, find watch page
    if (!pageUrl.includes('/watch/')) {
      const pageRes = await axios.get(encodeURI(pageUrl), { headers, httpsAgent: agent, timeout: 8000 });
      const $ = cheerio.load(pageRes.data);
      const wLink = $('a[href*="/watch/"]').first().attr('href');
      if (wLink) {
        watchUrl = wLink.startsWith('http') ? wLink : `${BASE_URL}${wLink}`;
      } else {
        // Fallback: replace /film/ or /episode/ with /watch/
        watchUrl = pageUrl.replace(/\/film\//, '/watch/').replace(/\/episode\//, '/watch/');
      }
    }

    // Fetch watch page to obtain session cookies and server list
    const watchRes = await axios.get(encodeURI(watchUrl), { headers, httpsAgent: agent, timeout: 8000 });
    const setCookie = watchRes.headers['set-cookie'];
    if (setCookie) {
      cookieHeader = setCookie.map(c => c.split(';')[0]).join('; ');
    }

    const match = watchRes.data.match(/let\s+servers\s*=\s*(\[.*?\]);/s);
    if (!match) return [];

    let servers = [];
    try {
      servers = JSON.parse(match[1]);
    } catch (_) {
      return [];
    }

    const streams = [];

    // Prioritize fast servers: earnvids (FastVid) and luluvdoo
    const sortedServers = [...servers].sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const score = name => (name.includes('earn') || name.includes('fast') ? 1 : (name.includes('lulu') ? 2 : 3));
      return score(aName) - score(bName);
    });

    for (const s of sortedServers.slice(0, 3)) {
      try {
        const redirectRes = await axios.get(`${BASE_URL}${s.url}`, {
          headers: {
            ...headers,
            'Referer': watchUrl,
            'Cookie': cookieHeader
          },
          httpsAgent: agent,
          maxRedirects: 0,
          validateStatus: () => true,
          timeout: 5000
        });

        const embedUrl = redirectRes.headers.location;
        if (!embedUrl) continue;

        // Fetch embed page and extract media
        const embedRes = await axios.get(embedUrl, {
          headers: { ...headers, 'Referer': BASE_URL },
          httpsAgent: agent,
          timeout: 6000
        });

        const mediaUrls = extractMediaUrls(embedRes.data);
        for (const mUrl of mediaUrls) {
          const isHls = mUrl.includes('.m3u8');
          streams.push({
            title: `[وي سيما] سيرفر ${s.name || 'رئيسي'} (${isHls ? 'HD HLS' : 'MP4'})`,
            url: mUrl,
            referer: embedUrl
          });
        }

        if (streams.length >= 2) break;
      } catch (err) {}
    }

    return streams;
  } catch (err) {
    console.warn(`[WeCima] Failed to resolve streams for ${pageUrl}: ${err.message}`);
    return [];
  }
}

module.exports = {
  scrapeWeCimaMovies,
  scrapeWeCimaSeries,
  getWeCimaSeriesEpisodes,
  resolveWeCimaStreams,
  BASE_URL
};
