const axios = require('axios');

async function testAll() {
  const tests = [
    { name: 'Manifest', path: '/manifest.json' },
    { name: 'Movies Home', path: '/catalog/movie/kirmalk_movies.json' },
    { name: 'Movies Home skip=0', path: '/catalog/movie/kirmalk_movies/skip=0.json' },
    { name: 'Series Home', path: '/catalog/series/kirmalk_series.json' },
    { name: 'Series Home skip=0', path: '/catalog/series/kirmalk_series/skip=0.json' },
    { name: 'Discover Movie All', path: '/catalog/movie/kirmalk_movies/genre=%D8%A7%D9%84%D9%83%D9%84.json' },
    { name: 'Discover Movie Arabic', path: '/catalog/movie/kirmalk_movies/genre=%D8%A3%D9%81%D9%84%D8%A7%D9%85%20%D8%B9%D8%B1%D8%A8%D9%8A.json' },
    { name: 'Discover Plays', path: '/catalog/movie/kirmalk_movies/genre=%D9%85%D8%B3%D8%B1%D8%AD%D9%8A%D8%A7%D8%AA.json' },
    { name: 'Discover Series All', path: '/catalog/series/kirmalk_series/genre=%D8%A7%D9%84%D9%83%D9%84.json' },
    { name: 'Discover Turkish', path: '/catalog/series/kirmalk_series/genre=%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA%20%D8%AA%D8%B1%D9%83%D9%8A%D8%A9.json' },
    { name: 'Discover Egyptian', path: '/catalog/series/kirmalk_series/genre=%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA%20%D9%85%D8%B5%D8%B1%D9%8A%D8%A9.json' },
    { name: 'Discover Syrian', path: '/catalog/series/kirmalk_series/genre=%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA%20%D8%B4%D8%A7%D9%85%D9%8A%D8%A9.json' },
    { name: 'Discover Gulf', path: '/catalog/series/kirmalk_series/genre=%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA%20%D8%AE%D9%84%D9%8A%D8%AC%D9%8A%D8%A9.json' },
    { name: 'Discover Ramadan', path: '/catalog/series/kirmalk_series/genre=%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA%20%D8%B1%D9%85%D8%B6%D8%A7%D9%86.json' },
    { name: 'Movie Stream', path: '/stream/movie/km_m_1993c7d98.json' },
    { name: 'Series Meta (Kalabsh)', path: '/meta/series/km_s_bc1341b69.json' },
    { name: 'Series Stream (Kalabsh Ep 1)', path: '/stream/series/km_s_bc1341b69:1:1.json' },
    { name: 'Series Stream (Kalabsh Ep 2)', path: '/stream/series/km_s_bc1341b69:1:2.json' },
    { name: 'Series Stream (Zil Al Helm Ep 1)', path: '/stream/series/km_s_1cc62c4b8:1:1.json' }
  ];

  console.log('\n--- TESTING PRODUCTION VERCEL ENDPOINTS ---\n');
  for (const t of tests) {
    try {
      const res = await axios.get('https://kirmalk-addon.vercel.app' + t.path, { timeout: 15000 });
      let result = 'unknown';
      if (res.data.metas) {
        result = `${res.data.metas.length} items`;
      } else if (res.data.streams) {
        result = `${res.data.streams.length} stream links`;
      } else if (res.data.meta) {
        result = `${res.data.meta.name} (${res.data.meta.videos?.length || 0} eps)`;
      } else if (res.data.catalogs) {
        result = 'valid manifest';
      }
      console.log(`[PASS] ${t.name.padEnd(25)} => Status: ${res.status} | ${result}`);
    } catch (e) {
      console.log(`[FAIL] ${t.name.padEnd(25)} => ${e.message}`);
    }
  }
  console.log('\n------------------------------------------\n');
}

testAll();
