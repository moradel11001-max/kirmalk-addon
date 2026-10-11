const { getStreamsFor } = require('../scraper');
const initialData = require('../initial_data.json');

async function findMissing() {
  const hostUrl = 'https://kirmalk-addon.vercel.app';
  console.log('Testing 30 random movies for streams...');
  const missingMovies = [];
  const moviesSample = initialData.movies.slice(0, 30);
  for (const m of moviesSample) {
    const s = await getStreamsFor(m.id, null, null, hostUrl);
    if (s.length === 0) {
      missingMovies.push(m);
    }
  }
  console.log(`Missing movies in first 30: ${missingMovies.length}`);
  missingMovies.forEach(m => console.log(`  - "${m.name}" (${m.id})`));

  console.log('\nTesting 30 series (Episode 1) for streams...');
  const missingSeries = [];
  const seriesSample = initialData.series.slice(0, 30);
  for (const s of seriesSample) {
    const meta = initialData.unifiedSeries[s.id] || initialData.unifiedSeries[s.id.replace(/^(km|ak|wc)_[ms]_?/, '')];
    if (meta && meta.videos && meta.videos.length > 0) {
      const ep1 = meta.videos[0];
      const streams = await getStreamsFor(ep1.id, '1', '1', hostUrl);
      if (streams.length === 0) {
        missingSeries.push({ series: s.name, epId: ep1.id });
      }
    }
  }
  console.log(`Missing series in first 30: ${missingSeries.length}`);
  missingSeries.forEach(s => console.log(`  - "${s.series}" (${s.epId})`));
}

findMissing().catch(console.error);
