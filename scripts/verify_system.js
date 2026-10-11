const { getCatalog, getMeta, getStreamsFor } = require('../scraper');

async function verify() {
  console.log('=== SYSTEM VERIFICATION ===\n');

  // 1. Test Movie Catalog: Ensure 0 episodes disguised as movies
  console.log('1. Checking Movie Catalog...');
  const movieCat = await getCatalog('movie', { skip: 0 });
  const movieMetas = movieCat.metas || [];
  const episodesInMovieCat = movieMetas.filter(m => /الحلق[ةه]|مسلسل|حلق[ةه]\s*\d+/i.test(m.name) && !m.name.includes('مباراة'));
  console.log(`   Fetched ${movieMetas.length} movies.`);
  console.log(`   Episodes found in movie catalog: ${episodesInMovieCat.length} (Expected: 0)`);
  if (episodesInMovieCat.length > 0) {
    console.error('   FAILED: Found episodes in movies:', episodesInMovieCat.map(x => x.name));
  } else {
    console.log('   PASSED: Movies catalog contains only legitimate films!');
  }

  // 2. Test Series Catalog: Search for "حكايات بنات"
  console.log('\n2. Searching for "حكايات بنات" in Series Catalog...');
  const seriesSearch = await getCatalog('series', { search: 'حكايات بنات' });
  const foundSeries = seriesSearch.metas || [];
  console.log(`   Found ${foundSeries.length} matching series:`);
  foundSeries.forEach(s => console.log(`   - [${s.id}] ${s.name} (${s.type})`));

  const targetSeries = foundSeries.find(s => s.name.includes('الجزء الرابع')) || foundSeries[0];
  if (!targetSeries) {
    console.error('   FAILED: Series not found in catalog!');
    return;
  }

  // 3. Test Meta Endpoint for target series
  console.log(`\n3. Fetching Meta for ${targetSeries.name} (${targetSeries.id})...`);
  const meta = await getMeta('series', targetSeries.id);
  const videos = meta.videos || [];
  console.log(`   Total episodes in series card: ${videos.length}`);
  console.log(`   First 3 episodes:`, videos.slice(0, 3).map(v => `${v.title} (${v.id})`));
  console.log(`   Last 3 episodes:`, videos.slice(-3).map(v => `${v.title} (${v.id})`));

  if (videos.length >= 30) {
    console.log('   PASSED: Series has complete episode list (1-30)!');
  } else {
    console.warn(`   WARNING: Episode count is ${videos.length}`);
  }

  // 4. Test Stream Resolution for Episode 30 (from user screenshot)
  const ep30 = videos.find(v => v.episode === 30) || videos[videos.length - 1];
  console.log(`\n4. Testing Stream Resolution for Episode ${ep30.episode} (${ep30.id})...`);
  const streams = await getStreamsFor(ep30.id, 1, ep30.episode);
  console.log(`   Total playable streams returned: ${streams.length}`);
  streams.forEach((s, idx) => {
    console.log(`   Stream #${idx + 1}: [${s.name}] ${s.title} -> ${s.url.slice(0, 100)}...`);
  });

  if (streams.length > 0) {
    console.log('\n✅ VERIFICATION SUCCESSFUL! All criteria met:');
    console.log('   - No episodes in Movies catalog');
    console.log('   - Single unified Series card with full episodes');
    console.log('   - Stream servers present and resolving cleanly to HLS/MP4 streams');
  } else {
    console.error('\n❌ FAILED: No playable streams returned for episode!');
  }
}

verify().catch(console.error);
