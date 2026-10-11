const fs = require('fs');
const path = require('path');
const { normalizeArabicTitle, titleSimilarity } = require('./sources/normalizer');

const file = path.join(__dirname, 'initial_data.json');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));

console.log('=== CATALOG AUDIT ===');
console.log('Total movies in d.movies:', d.movies.length);
console.log('Total series in d.series:', d.series.length);

// 1. Check episodes in movies
const episodesInMovies = d.movies.filter(m => /مسلسل|الحلقة|حلقة\s*\d+/i.test(m.name));
console.log(`Episodes disguised as movies: ${episodesInMovies.length}`);
episodesInMovies.slice(0, 5).forEach(m => console.log('  -', m.name));

// 2. Check duplicate series in d.series
const seriesByNorm = new Map();
let duplicateSeriesCount = 0;
for (const s of d.series) {
  const norm = normalizeArabicTitle(s.name);
  if (!seriesByNorm.has(norm)) {
    seriesByNorm.set(norm, [s]);
  } else {
    duplicateSeriesCount++;
    seriesByNorm.get(norm).push(s);
  }
}
console.log(`Duplicate series by normalized name: ${duplicateSeriesCount}`);

// 3. Check server coverage
let episodesWithServers = 0;
let episodesTotal = 0;
for (const [id, s] of Object.entries(d.unifiedSeries || {})) {
  if (s && s.videos) {
    for (const v of s.videos) {
      episodesTotal++;
      if (d.servers[v.vid] && d.servers[v.vid].length > 0) {
        episodesWithServers++;
      }
    }
  }
}
console.log(`Episode server coverage: ${episodesWithServers} / ${episodesTotal} (${((episodesWithServers/episodesTotal)*100).toFixed(1)}%)`);
