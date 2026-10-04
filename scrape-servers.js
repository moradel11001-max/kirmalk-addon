const fs = require('fs');
const path = require('path');
const { scrapeWatchServers } = require('./scraper');

async function scrapeAllServers() {
  const dataFile = path.join(__dirname, 'initial_data.json');
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

  if (!data.servers) {
    data.servers = {};
  }

  const all = [
    ...(data.movies || []),
    ...(data.series || []),
    ...(data.turkish || []),
    ...(data.egyptian || []),
    ...(data.syrian || []),
    ...(data.gulf || []),
    ...(data.ramadan || []),
    ...(data.plays || [])
  ];

  const uniqueVids = [...new Set(all.map(i => i.id.replace(/^km_[ms]_/, '')))];
  console.log(`Starting server scrape for ${uniqueVids.length} unique titles...`);

  const concurrency = 6;
  let done = 0;
  let success = 0;

  for (let i = 0; i < uniqueVids.length; i += concurrency) {
    const chunk = uniqueVids.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (vid) => {
      if (data.servers[vid] && data.servers[vid].length > 0) {
        done++;
        success++;
        return;
      }
      try {
        const { servers } = await scrapeWatchServers(vid);
        if (servers && servers.length > 0) {
          data.servers[vid] = servers;
          success++;
        }
      } catch (_) {}
      done++;
    }));

    if (done % 50 === 0 || done === uniqueVids.length) {
      console.log(`Progress: ${done}/${uniqueVids.length} (found servers for ${success})`);
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
    }
  }

  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\nCOMPLETED: Scraped servers for ${success}/${uniqueVids.length} titles!`);
}

scrapeAllServers();
