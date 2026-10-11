const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const DATA_FILE = path.join(__dirname, '..', 'initial_data.json');
const initialData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const discovered = JSON.parse(fs.readFileSync(path.join(__dirname, 'discovered_series.json'), 'utf8'));

if (!initialData.servers) initialData.servers = {};
if (!initialData.unifiedSeries) initialData.unifiedSeries = {};
if (!initialData.seriesMeta) initialData.seriesMeta = {};
if (!initialData.epToSeries) initialData.epToSeries = {};

// 1. Build unified series structures
const categoryLists = {
  series: [],
  turkish: [],
  egyptian: [],
  syrian: [],
  gulf: [],
  ramadan: []
};

console.log(`Processing ${discovered.length} discovered series...`);

for (const s of discovered) {
  const seriesId = `km_s_${s.mainVid}`;
  const catalogItem = {
    id: seriesId,
    type: 'series',
    name: s.name,
    poster: s.poster,
    description: s.description || `${s.name} بجودة عالية`,
    genres: s.genres && s.genres.length > 0 ? s.genres : ['مسلسلات']
  };

  // Add to unifiedSeries (both with km_s_ prefix and raw vid)
  const unifiedObj = {
    id: seriesId,
    type: 'series',
    name: s.name,
    poster: s.poster,
    background: s.poster,
    description: s.description || `${s.name} بجودة عالية`,
    genres: catalogItem.genres,
    videos: s.videos.map(v => ({
      id: `${seriesId}:1:${v.episode}:${v.vid}`,
      title: v.title || `الحلقة ${v.episode}`,
      season: 1,
      episode: v.episode,
      vid: v.vid
    }))
  };

  initialData.unifiedSeries[seriesId] = unifiedObj;
  initialData.unifiedSeries[s.mainVid] = unifiedObj;

  // Add to seriesMeta
  initialData.seriesMeta[s.mainVid] = s.videos.map(v => ({
    episode: v.episode,
    vid: v.vid
  }));

  // Add to epToSeries
  for (const v of s.videos) {
    initialData.epToSeries[v.vid] = {
      seriesId,
      mainVid: s.mainVid,
      episode: v.episode
    };
  }

  // Categorize
  for (const cat of (s.categories || ['series'])) {
    if (categoryLists[cat]) {
      categoryLists[cat].push(catalogItem);
    }
  }
}

// Assign clean lists back to initialData
initialData.series = categoryLists.series;
initialData.turkish = categoryLists.turkish;
initialData.egyptian = categoryLists.egyptian;
initialData.syrian = categoryLists.syrian;
initialData.gulf = categoryLists.gulf;
initialData.ramadan = categoryLists.ramadan;

console.log('Clean Series Counts:');
console.log(`  - General Series: ${initialData.series.length}`);
console.log(`  - Turkish: ${initialData.turkish.length}`);
console.log(`  - Egyptian: ${initialData.egyptian.length}`);
console.log(`  - Syrian: ${initialData.syrian.length}`);
console.log(`  - Gulf: ${initialData.gulf.length}`);
console.log(`  - Ramadan: ${initialData.ramadan.length}`);

// 2. Determine target episodes to scrape
const episodesToScrape = [];
for (const s of discovered) {
  const limit = s.videos.length <= 35 ? s.videos.length : 30;
  const targetVideos = s.videos.slice(0, limit);
  for (const v of targetVideos) {
    if (!initialData.servers[v.vid] || initialData.servers[v.vid].length === 0) {
      episodesToScrape.push(v);
    }
  }
}

console.log(`\nTotal priority episodes to scrape: ${episodesToScrape.length}`);
console.log(`Already cached servers count: ${Object.keys(initialData.servers).length}`);

// Helper to scrape servers for a vid
async function extractServers(vid) {
  const servers = [];
  try {
    const res = await axios.get(`https://kirmalk.com/view.php?vid=${vid}`, {
      headers: { 'User-Agent': 'okhttp/4.9.3' },
      timeout: 5000
    });
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
      const res = await axios.get(`https://kirmalk.com/watch.php?vid=${vid}`, {
        headers: { 'User-Agent': 'okhttp/4.9.3' },
        timeout: 5000
      });
      const data = res.data;
      const m = data.match(/"embedUrl":\s*"([^"]+)"/);
      if (m && m[1]) {
        servers.push({ server: 1, label: 'سيرفر رئيسي', embed: m[1] });
      } else {
        const $ = cheerio.load(data);
        const link = $('link[itemprop="embedUrl"]').attr('href');
        if (link) servers.push({ server: 1, label: 'سيرفر رئيسي', embed: link });
      }
    } catch (_) {}
  }

  if (servers.length === 0) {
    try {
      const res = await axios.get(`https://kirmalk.com/embed.php?vid=${vid}`, {
        headers: { 'User-Agent': 'okhttp/4.9.3' },
        timeout: 5000
      });
      const $ = cheerio.load(res.data);
      const iframeSrc = $('iframe').attr('src');
      if (iframeSrc && !iframeSrc.includes('challenge-platform')) {
        servers.push({ server: 1, label: 'سيرفر رئيسي', embed: iframeSrc });
      }
    } catch (_) {}
  }

  return servers;
}

async function scrapeMissingEpisodes() {
  const concurrency = 12;
  let done = 0;
  let foundCount = 0;
  const total = episodesToScrape.length;

  for (let i = 0; i < total; i += concurrency) {
    const chunk = episodesToScrape.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (ep) => {
      try {
        const s = await extractServers(ep.vid);
        if (s && s.length > 0) {
          initialData.servers[ep.vid] = s;
          foundCount++;
        }
      } catch (_) {}
      done++;
    }));

    if (done % 60 === 0 || done === total) {
      process.stdout.write(`Scraped: ${done}/${total} (found servers: ${foundCount})\r`);
      fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
  console.log(`\n\nCOMPLETED! Total servers cached now: ${Object.keys(initialData.servers).length}`);
}

scrapeMissingEpisodes();
