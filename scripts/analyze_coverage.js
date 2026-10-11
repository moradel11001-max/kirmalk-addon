const data = require('../initial_data.json');

console.log('=== DATA ANALYSIS ===');
console.log('Total movies:', data.movies?.length);
console.log('Total series:', data.series?.length);
console.log('Total turkish:', data.turkish?.length);
console.log('Total foreign_movies:', data.foreign_movies?.length);
console.log('Total foreign_series:', data.foreign_series?.length);
console.log('Total dubbed_series:', data.dubbed_series?.length);
console.log('Total ramadan:', data.ramadan?.length);

// Check servers breakdown
let kmCount = 0, akCount = 0, wcCount = 0;
for (const [vid, srvs] of Object.entries(data.servers)) {
  for (const s of srvs) {
    if (s.source === 'akwam') akCount++;
    else if (s.source === 'wecima') wcCount++;
    else kmCount++;
  }
}
console.log(`Servers breakdown: Kirmalk=${kmCount}, Akwam=${akCount}, WeCima=${wcCount}`);

// Check why some series have no servers
let seriesWithNoServers = 0;
let seriesWithServers = 0;
for (const s of (data.series || [])) {
  const meta = data.unifiedSeries[s.id] || data.unifiedSeries[s.id.replace(/^(km|ak|wc)_[ms]_?/, '')];
  if (meta && meta.videos && meta.videos.length > 0) {
    const firstEpVid = meta.videos[0].vid || meta.videos[0].id.split(':').pop();
    const srvs = data.servers[firstEpVid] || data.servers[meta.videos[0].id] || [];
    if (srvs.length === 0) {
      seriesWithNoServers++;
      if (seriesWithNoServers <= 5) {
        console.log(`  No servers series sample: "${s.name}" (${s.id}), epVid: ${firstEpVid}`);
      }
    } else {
      seriesWithServers++;
    }
  }
}
console.log(`Series with working servers on ep 1: ${seriesWithServers}, Series with NO servers on ep 1: ${seriesWithNoServers}`);
