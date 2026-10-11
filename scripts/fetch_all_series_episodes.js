const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const d = require('../initial_data.json');

function cleanSeriesName(title) {
  return title
    .replace(/^مسلسل\s+/gi, '')
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

const categories = ['series', 'turkish', 'egyptian', 'syrian', 'gulf', 'ramadan'];
const seriesMap = new Map();

for (const cat of categories) {
  for (const card of (d[cat] || [])) {
    const cleanName = cleanSeriesName(card.name);
    if (!seriesMap.has(cleanName)) {
      const vid = card.id.replace(/^km_[ms]_?/, '');
      seriesMap.set(cleanName, {
        cleanName,
        name: 'مسلسل ' + cleanName,
        vid,
        id: `km_s_${vid}`,
        poster: card.poster,
        categories: [cat]
      });
    } else {
      const entry = seriesMap.get(cleanName);
      if (!entry.categories.includes(cat)) {
        entry.categories.push(cat);
      }
    }
  }
}

const seriesList = Array.from(seriesMap.values());
console.log(`Starting episode discovery for ${seriesList.length} series...`);

async function fetchSeries(s) {
  try {
    const res = await axios.get(`https://kirmalk.com/view.php?vid=${s.vid}`, {
      headers: { 'User-Agent': 'okhttp/4.9.3' },
      timeout: 8000
    });
    const $ = cheerio.load(res.data);

    let parsedName = s.name;
    $('.details-line').each((_, el) => {
      const text = $(el).text();
      if (text.includes('المسلسل:')) {
        const parts = text.split('المسلسل:');
        if (parts[1]) parsedName = 'مسلسل ' + parts[1].trim();
      }
    });

    const description = $('.watch-extra-info, .watch-description').text().trim() || '';
    const genres = [];
    $('.details-line span a, .watch-information-section a[href*="category.php"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && !genres.includes(text)) genres.push(text);
    });

    const episodes = [];
    $('.episodes-grid-classic a.classic-episode-item').each((idx, el) => {
      const href = $(el).attr('href');
      const m = href.match(/vid=([a-z0-9]+)/i);
      const epVid = m ? m[1] : null;
      const num = parseInt($(el).find('.episode-number-large').text().trim(), 10) || (idx + 1);
      if (epVid) {
        episodes.push({ episode: num, vid: epVid });
      }
    });

    if (episodes.length === 0) {
      episodes.push({ episode: 1, vid: s.vid });
    }

    episodes.sort((a, b) => a.episode - b.episode);

    // Also extract servers for the current vid if available on this page
    const servers = [];
    $('#WatchServers .server-btn').each((_, el) => {
      const btn = $(el);
      const embed = btn.attr('data-embed');
      if (embed) {
        servers.push({
          server: parseInt(btn.attr('data-server') || '0', 10),
          label: btn.find('span').text().trim() || `سيرفر ${btn.attr('data-server')}`,
          embed
        });
      }
    });

    return {
      success: true,
      data: {
        id: s.id,
        mainVid: s.vid,
        name: parsedName,
        poster: s.poster,
        description,
        genres,
        categories: s.categories,
        videos: episodes.map(ep => ({
          id: `${s.id}:1:${ep.episode}:${ep.vid}`,
          title: `الحلقة ${ep.episode}`,
          season: 1,
          episode: ep.episode,
          vid: ep.vid
        })),
        currentServers: servers
      }
    };
  } catch (e) {
    return { success: false, vid: s.vid, error: e.message };
  }
}

async function run() {
  const results = [];
  const concurrency = 6;
  for (let i = 0; i < seriesList.length; i += concurrency) {
    const chunk = seriesList.slice(i, i + concurrency);
    const chunkRes = await Promise.all(chunk.map(fetchSeries));
    results.push(...chunkRes);
    process.stdout.write(`Processed ${Math.min(i + concurrency, seriesList.length)}/${seriesList.length}\r`);
  }

  const successful = results.filter(r => r.success).map(r => r.data);
  const failed = results.filter(r => !r.success);

  console.log(`\nCompleted! Successful: ${successful.length}, Failed: ${failed.length}`);

  let totalEpisodes = 0;
  const allEpVids = new Set();
  successful.forEach(s => {
    totalEpisodes += s.videos.length;
    s.videos.forEach(v => allEpVids.add(v.vid));
  });

  console.log(`Total episodes across all series: ${totalEpisodes}`);
  console.log(`Unique episode VIDs: ${allEpVids.size}`);

  const existingServers = d.servers || {};
  let alreadyHave = 0;
  let missing = 0;
  for (const epVid of allEpVids) {
    if (existingServers[epVid] && existingServers[epVid].length > 0) {
      alreadyHave++;
    } else {
      missing++;
    }
  }

  console.log(`Episodes already with servers in initial_data.json: ${alreadyHave}`);
  console.log(`Episodes missing servers: ${missing}`);

  // Save intermediate discovery to a temporary file
  fs.writeFileSync('./scripts/discovered_series.json', JSON.stringify(successful, null, 2), 'utf8');
  console.log('Saved discovered series to ./scripts/discovered_series.json');
}

run();
