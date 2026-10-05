const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const DATA_FILE = path.join(__dirname, '..', 'initial_data.json');
const initialData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

const http = axios.create({
  headers: {
    'User-Agent': 'okhttp/4.9.3',
    'Referer': 'https://kirmalk.com/'
  },
  timeout: 8000
});

async function extractServers(vid) {
  const servers = [];
  try {
    const res = await http.get(`https://kirmalk.com/view.php?vid=${vid}`);
    const $ = cheerio.load(res.data);
    $('#WatchServers [data-embed]').each((_, el) => {
      const embed = $(el).attr('data-embed');
      if (embed) {
        servers.push({
          server: parseInt($(el).attr('data-server') || '0', 10),
          label: $(el).find('span').text().trim() || $(el).text().trim() || 'سيرفر',
          embed
        });
      }
    });
    if (servers.length === 0) {
      const iframeSrc = $('#Playerholder iframe, iframe').attr('src');
      if (iframeSrc && !iframeSrc.includes('challenge-platform')) {
        servers.push({ server: 1, label: 'سيرفر رئيسي', embed: iframeSrc });
      }
    }
  } catch (_) {}

  if (servers.length === 0) {
    try {
      const res = await http.get(`https://kirmalk.com/watch.php?vid=${vid}`);
      const m = res.data.match(/"embedUrl":\s*"([^"]+)"/);
      if (m && m[1]) {
        servers.push({ server: 1, label: 'سيرفر رئيسي', embed: m[1] });
      }
    } catch (_) {}
  }
  return servers;
}

async function scrapeLatestCategory(catSlug, type = 'movie') {
  try {
    const res = await http.get(`https://kirmalk.com/category.php?cat=${catSlug}&page=1`);
    const $ = cheerio.load(res.data);
    const items = [];
    $('.video-item, .video-thumb').each((_, el) => {
      const link = $(el).find('a').first().attr('href') || '';
      const m = link.match(/vid=([a-z0-9]+)/i);
      const vid = m ? m[1] : null;
      const title = $(el).find('.video-title, .title').text().trim();
      const img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
      if (vid && title) {
        items.push({
          id: `km_${type === 'movie' ? 'm' : 's'}_${vid}`,
          type,
          name: title,
          poster: img.startsWith('http') ? img : `https://kirmalk.com/${img.replace(/^\//, '')}`,
          vid
        });
      }
    });
    return items;
  } catch (e) {
    console.error(`Failed to scrape ${catSlug}:`, e.message);
    return [];
  }
}

async function runAutoUpdate() {
  console.log('Running Auto-Update...');
  let newServersCount = 0;

  // 1. Check latest movies
  const latestMovies = await scrapeLatestCategory('movies21', 'movie');
  for (const m of latestMovies) {
    const exists = initialData.movies.some(item => item.id === m.id);
    if (!exists) {
      console.log(`Found new movie: ${m.name} (${m.id})`);
      initialData.movies.unshift(m);
      const srv = await extractServers(m.vid);
      if (srv.length > 0) {
        initialData.servers[m.vid] = srv;
        newServersCount++;
      }
    }
  }

  // 2. Check latest series episodes
  const seriesCategories = ['turk14', 'serieseg4', 'seriessy5', 'series5l', 'rmadan27'];
  for (const cat of seriesCategories) {
    const latestItems = await scrapeLatestCategory(cat, 'series');
    for (const item of latestItems) {
      if (!initialData.servers[item.vid]) {
        const srv = await extractServers(item.vid);
        if (srv.length > 0) {
          initialData.servers[item.vid] = srv;
          newServersCount++;
          console.log(`Found servers for new series/episode: ${item.name} (${item.vid})`);
        }
      }
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
  console.log(`Auto-Update complete! Added servers for ${newServersCount} new items.`);

  // 3. Sync Akwam & WeCima multi-source content
  try {
    const { runMerger } = require('./merge_multi_sources');
    console.log('Running Akwam & WeCima sync...');
    await runMerger();
  } catch (err) {
    console.error('Multi-source merger error in auto update:', err.message);
  }
}

if (require.main === module) {
  runAutoUpdate();
}

module.exports = { runAutoUpdate };
