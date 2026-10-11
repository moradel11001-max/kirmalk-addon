/**
 * High-Performance Deep Multi-Source Catalog Merger & Backup Server Linker
 * Ingests thousands of series & movies from Kirmalk, Akwam, and WeCima
 * Concurrently extracts episodes and routes titles into granular genres
 */

const fs = require('fs');
const path = require('path');
const { normalizeArabicTitle, titleSimilarity } = require('../sources/normalizer');
const {
  scrapeKirmalkSeries,
  scrapeKirmalkCategory,
  scrapeKirmalkMovies,
  getKirmalkSeriesEpisodes,
  extractKirmalkServers
} = require('../sources/kirmalk');
const {
  scrapeAkwamMovies,
  scrapeAkwamSeries,
  getAkwamSeriesEpisodes
} = require('../sources/akwam');
const {
  scrapeWeCimaMovies,
  scrapeWeCimaSeries,
  getWeCimaSeriesEpisodes
} = require('../sources/wecima');

const INITIAL_DATA_FILE = path.join(__dirname, '../initial_data.json');

// Concurrency helper for batching network requests
async function mapConcurrent(items, concurrency, fn, onProgress) {
  const results = [];
  let done = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkRes = await Promise.all(chunk.map(fn));
    results.push(...chunkRes);
    done += chunk.length;
    if (onProgress) onProgress(done, items.length);
  }
  return results;
}

async function runMerger(options = {}) {
  const isDeep = process.argv.includes('--deep') || options.deep !== false;
  
  // Page limits: in deep mode, crawls wide across all archives
  const KIRMALK_SERIES_PAGES = options.kirmalkSeriesPages || (isDeep ? 35 : parseInt(process.env.KIRMALK_SERIES_PAGES || '5', 10));
  const KIRMALK_MOVIE_PAGES = options.kirmalkMoviePages || (isDeep ? 20 : parseInt(process.env.KIRMALK_MOVIE_PAGES || '5', 10));
  const KIRMALK_GENRE_PAGES = options.kirmalkGenrePages || (isDeep ? 10 : 2);
  const AKWAM_SERIES_PAGES = options.akwamSeriesPages || (isDeep ? 30 : parseInt(process.env.AKWAM_SERIES_PAGES || '5', 10));
  const AKWAM_MOVIE_PAGES = options.akwamMoviePages || (isDeep ? 30 : parseInt(process.env.AKWAM_MOVIE_PAGES || '5', 10));
  const WECIMA_PAGES = options.wecimaPages || (isDeep ? 6 : parseInt(process.env.WECIMA_PAGES || '2', 10));

  console.log('================================================================');
  console.log('  STARTING DEEP MULTI-SOURCE INGESTION (KIRMALK + AKWAM + WECIMA)');
  console.log(`  Mode: ${isDeep ? 'FULL ARCHIVE DEEP CRAWL' : 'INCREMENTAL'}`);
  console.log(`  Target Pages: Kirmalk S:${KIRMALK_SERIES_PAGES}/M:${KIRMALK_MOVIE_PAGES}/Genres:${KIRMALK_GENRE_PAGES} | Akwam S:${AKWAM_SERIES_PAGES}/M:${AKWAM_MOVIE_PAGES}`);
  console.log('================================================================');

  if (!fs.existsSync(INITIAL_DATA_FILE)) {
    console.error('initial_data.json not found!');
    return;
  }

  const data = JSON.parse(fs.readFileSync(INITIAL_DATA_FILE, 'utf8'));

  // Ensure all category arrays exist
  data.movies = data.movies || [];
  data.series = data.series || [];
  data.turkish = data.turkish || [];
  data.egyptian = data.egyptian || [];
  data.syrian = data.syrian || [];
  data.gulf = data.gulf || [];
  data.ramadan = data.ramadan || [];
  data.plays = data.plays || [];
  data.foreign_movies = data.foreign_movies || [];
  data.foreign_series = data.foreign_series || [];
  data.dubbed_series = data.dubbed_series || [];
  data.servers = data.servers || {};
  data.seriesMeta = data.seriesMeta || {};
  data.unifiedSeries = data.unifiedSeries || {};
  data.epToSeries = data.epToSeries || {};

  console.log(`Starting with: ${data.movies.length} movies, ${data.series.length} series, ${Object.keys(data.servers).length} server keys.`);

  // Lookup maps for fast fuzzy matching
  const existingMovies = [];
  for (const m of data.movies) {
    existingMovies.push({
      item: m,
      norm: normalizeArabicTitle(m.name),
      vid: m.id.replace(/^(km|ak|wc)_[ms]_?/, '')
    });
  }

  const existingSeries = [];
  for (const s of data.series) {
    existingSeries.push({
      item: s,
      norm: normalizeArabicTitle(s.name),
      vid: s.id.replace(/^(km|ak|wc)_[ms]_?/, '')
    });
  }

  function findMovieMatch(title) {
    const norm = normalizeArabicTitle(title);
    if (!norm) return null;
    for (const em of existingMovies) {
      if (em.norm === norm || titleSimilarity(em.norm, norm) >= 0.85) {
        return em;
      }
    }
    return null;
  }

  function findSeriesMatch(title) {
    const norm = normalizeArabicTitle(title);
    if (!norm) return null;
    for (const es of existingSeries) {
      if (es.norm === norm || titleSimilarity(es.norm, norm) >= 0.85) {
        return es;
      }
    }
    return null;
  }

  function saveCompactData() {
    try {
      fs.writeFileSync(INITIAL_DATA_FILE, JSON.stringify(data), 'utf8');
    } catch (e) {
      console.warn('Auto-save error:', e.message);
    }
  }

  // ==========================================
  // 1. CRAWL KIRMALK SUB-GENRES
  // ==========================================
  console.log('\n--- 1. Fetching Kirmalk Specific Categories (Egyptian, Syrian, Gulf, Turkish, Ramadan) ---');
  const genreConfigs = [
    { slug: 'serieseg4', name: 'egyptian', label: 'مسلسلات مصرية' },
    { slug: 'seriessy5', name: 'syrian', label: 'مسلسلات شامية' },
    { slug: 'series5l', name: 'gulf', label: 'مسلسلات خليجية' },
    { slug: 'turk14', name: 'turkish', label: 'مسلسلات تركية' },
    { slug: 'rmadan27', name: 'ramadan', label: 'مسلسلات رمضان' }
  ];

  const allDiscoveredKirmalkSeries = [];

  for (const g of genreConfigs) {
    try {
      console.log(`Scraping Kirmalk ${g.label} (cat=${g.slug})...`);
      const items = await scrapeKirmalkCategory(g.slug, KIRMALK_GENRE_PAGES, g.name);
      console.log(`  -> Found ${items.length} titles in ${g.label}`);
      for (const item of items) {
        allDiscoveredKirmalkSeries.push(item);
      }
    } catch (e) {
      console.warn(`Error on ${g.label}: ${e.message}`);
    }
  }

  // ==========================================
  // 2. CRAWL KIRMALK ALL-SERIES & MOVIES
  // ==========================================
  console.log('\n--- 2. Fetching Kirmalk General Series Archive & Movies Archive ---');
  try {
    const generalSeries = await scrapeKirmalkSeries(KIRMALK_SERIES_PAGES);
    console.log(`  -> Found ${generalSeries.length} titles from all-series.php (pages 1-${KIRMALK_SERIES_PAGES})`);
    for (const item of generalSeries) {
      allDiscoveredKirmalkSeries.push(item);
    }
  } catch (e) {
    console.warn(`Error on Kirmalk all-series: ${e.message}`);
  }

  // Ingest Kirmalk Movies
  try {
    console.log(`Scraping Kirmalk movies (pages 1-${KIRMALK_MOVIE_PAGES})...`);
    const kmMovies = await scrapeKirmalkMovies(KIRMALK_MOVIE_PAGES);
    console.log(`  -> Found ${kmMovies.length} movies from movies.php`);
    let addedKmCount = 0;
    for (const m of kmMovies) {
      if (!data.movies.some(x => x.id === m.id || x.rawId === m.rawId)) {
        addedKmCount++;
        data.movies.push(m);
        existingMovies.push({ item: m, norm: normalizeArabicTitle(m.name), vid: m.rawId });
        data.servers[m.rawId] = [{
          server: 1,
          label: 'سيرفر كرمالك الرئيسي',
          embed: m.href,
          source: 'kirmalk'
        }];
        data.servers[m.id] = data.servers[m.rawId];
      }
    }
    console.log(`Kirmalk Movies: ${addedKmCount} new movies added to catalog.`);
  } catch (e) {
    console.warn(`Error on Kirmalk movies: ${e.message}`);
  }

  // Filter unique Kirmalk series to ingest
  const uniqueKirmalkToIngest = [];
  const seenKmNames = new Set();
  for (const s of allDiscoveredKirmalkSeries) {
    const norm = normalizeArabicTitle(s.name);
    if (!seenKmNames.has(norm)) {
      seenKmNames.add(norm);
      uniqueKirmalkToIngest.push(s);
    }
  }

  console.log(`\nTotal unique Kirmalk series discovered: ${uniqueKirmalkToIngest.length}`);
  const newKmToIngest = uniqueKirmalkToIngest.filter(ks => !data.unifiedSeries[ks.rawId] && !data.series.some(s => s.id === ks.id));
  console.log(`New Kirmalk series requiring episode ingestion: ${newKmToIngest.length}`);

  let kmProcessed = 0;
  await mapConcurrent(newKmToIngest, 12, async (ks) => {
    try {
      const eps = await getKirmalkSeriesEpisodes(ks.sampleVid);
      if (eps.length === 0) return;

      const seriesId = ks.id;
      const videos = eps.map(e => ({
        id: `${seriesId}:1:${e.episode}:${e.vid}`,
        title: e.title || `الحلقة ${e.episode}`,
        season: 1,
        episode: e.episode,
        vid: e.vid,
        href: e.href
      }));

      for (const e of eps) {
        const srv = [{
          server: 1,
          label: 'سيرفر كرمالك الرئيسي',
          embed: e.href,
          source: 'kirmalk'
        }];
        data.servers[e.vid] = srv;
        data.servers[e.href] = srv;
        data.epToSeries[e.vid] = seriesId;
      }

      const seriesMetaObj = {
        id: seriesId,
        type: 'series',
        name: ks.name,
        poster: ks.poster,
        source: 'kirmalk',
        href: ks.href,
        videos
      };

      data.unifiedSeries[ks.rawId] = seriesMetaObj;
      data.unifiedSeries[seriesId] = seriesMetaObj;
      data.seriesMeta[ks.rawId] = videos;

      const catalogItem = {
        id: seriesId,
        type: 'series',
        name: ks.name,
        poster: ks.poster,
        source: 'kirmalk'
      };

      data.series.push(catalogItem);
      existingSeries.push({ item: catalogItem, norm: normalizeArabicTitle(ks.name), vid: ks.rawId });

      // Route into sub-genre arrays
      if (ks.category === 'egyptian' || /مصر/i.test(ks.name)) {
        if (!data.egyptian.some(s => s.id === seriesId)) data.egyptian.push(catalogItem);
      } else if (ks.category === 'syrian' || /شام|سور/i.test(ks.name)) {
        if (!data.syrian.some(s => s.id === seriesId)) data.syrian.push(catalogItem);
      } else if (ks.category === 'gulf' || /خليج|كويت|سعود/i.test(ks.name)) {
        if (!data.gulf.some(s => s.id === seriesId)) data.gulf.push(catalogItem);
      } else if (ks.category === 'turkish' || /تركي/i.test(ks.name)) {
        if (!data.turkish.some(s => s.id === seriesId)) data.turkish.push(catalogItem);
      } else if (ks.category === 'ramadan' || /رمضان/i.test(ks.name)) {
        if (!data.ramadan.some(s => s.id === seriesId)) data.ramadan.push(catalogItem);
      }
    } catch (_) {}
  }, (done, total) => {
    kmProcessed = done;
    if (done % 50 === 0 || done === total) {
      process.stdout.write(`  [Kirmalk Episodes] Ingested ${done}/${total} series...\r`);
      saveCompactData();
    }
  });
  console.log(`\nKirmalk Series ingestion completed!`);
  saveCompactData();

  // ==========================================
  // 3. DEEP CRAWL AKWAM (PAGES 1-30)
  // ==========================================
  console.log('\n--- 3. Deep Ingestion of Akwam Content ---');
  try {
    console.log(`Scraping Akwam Arabic Movies (${AKWAM_MOVIE_PAGES} pages)...`);
    const akwamArMovies = await scrapeAkwamMovies(29, AKWAM_MOVIE_PAGES);
    console.log(`Scraping Akwam Foreign Movies (${AKWAM_MOVIE_PAGES} pages)...`);
    const akwamEnMovies = await scrapeAkwamMovies(30, AKWAM_MOVIE_PAGES);

    console.log(`Scraping Akwam General Series (${AKWAM_SERIES_PAGES} pages)...`);
    const akwamGeneralSeries = await scrapeAkwamSeries(null, null, AKWAM_SERIES_PAGES);
    console.log(`Scraping Akwam Turkish Series (${Math.floor(AKWAM_SERIES_PAGES / 2)} pages)...`);
    const akwamTurkishSeries = await scrapeAkwamSeries(32, null, Math.max(2, Math.floor(AKWAM_SERIES_PAGES / 2)));
    console.log(`Scraping Akwam Ramadan Series...`);
    const akwamRamadanSeries = await scrapeAkwamSeries(0, 87, 3);

    console.log(`Akwam scraped: ${akwamArMovies.length + akwamEnMovies.length} movies, ${akwamGeneralSeries.length + akwamTurkishSeries.length + akwamRamadanSeries.length} series.`);

    // Merge Akwam Movies
    let akwamMoviesMatched = 0;
    let akwamMoviesAdded = 0;

    for (const akm of [...akwamArMovies, ...akwamEnMovies]) {
      const match = findMovieMatch(akm.name);
      if (match) {
        akwamMoviesMatched++;
        const vid = match.vid;
        data.servers[vid] = data.servers[vid] || [];
        if (!data.servers[vid].some(s => s.source === 'akwam')) {
          data.servers[vid].push({
            server: 2,
            label: 'سيرفر أكوام (1080p MP4)',
            embed: akm.href,
            source: 'akwam'
          });
        }
      } else {
        akwamMoviesAdded++;
        const isForeign = akm.section === 30 || /[a-zA-Z]{3,}/.test(akm.name);
        const newItem = {
          id: akm.id,
          type: 'movie',
          name: akm.name,
          poster: akm.poster,
          source: 'akwam',
          href: akm.href
        };

        if (!data.movies.some(m => m.id === akm.id)) {
          data.movies.push(newItem);
          existingMovies.push({ item: newItem, norm: normalizeArabicTitle(akm.name), vid: akm.rawId });
        }

        if (isForeign && !data.foreign_movies.some(m => m.id === akm.id)) {
          data.foreign_movies.push(newItem);
        }

        data.servers[akm.rawId] = [{
          server: 1,
          label: 'سيرفر أكوام (1080p MP4)',
          embed: akm.href,
          source: 'akwam'
        }];
        data.servers[akm.id] = data.servers[akm.rawId];
      }
    }
    console.log(`Akwam Movies: ${akwamMoviesMatched} linked as backup servers, ${akwamMoviesAdded} new titles added.`);

    // Merge Akwam Series
    const allAkwamSeries = [...akwamGeneralSeries, ...akwamTurkishSeries, ...akwamRamadanSeries];
    const uniqueAkwam = [];
    const seenAk = new Set();
    for (const s of allAkwamSeries) {
      if (!seenAk.has(s.id)) {
        seenAk.add(s.id);
        uniqueAkwam.push(s);
      }
    }

    console.log(`Processing ${uniqueAkwam.length} unique Akwam series...`);

    let akMatched = 0;
    let akAdded = 0;

    await mapConcurrent(uniqueAkwam, 12, async (aks) => {
      const match = findSeriesMatch(aks.name);
      if (match) {
        akMatched++;
        try {
          const unified = data.unifiedSeries[match.vid] || data.unifiedSeries[`km_s_${match.vid}`];
          if (unified && unified.videos) {
            const ep1Vid = unified.videos[0]?.vid;
            const alreadyHas = ep1Vid && (data.servers[ep1Vid] || []).some(s => s.source === 'akwam');
            if (!alreadyHas) {
              const eps = await getAkwamSeriesEpisodes(aks.href);
              for (const ep of eps) {
                const uEp = unified.videos.find(v => v.episode === ep.episode);
                if (uEp && uEp.vid) {
                  data.servers[uEp.vid] = data.servers[uEp.vid] || [];
                  if (!data.servers[uEp.vid].some(s => s.source === 'akwam')) {
                    data.servers[uEp.vid].push({
                      server: 2,
                      label: 'سيرفر أكوام (MP4)',
                      embed: ep.href,
                      source: 'akwam'
                    });
                  }
                }
              }
            }
          }
        } catch (_) {}
      } else {
        akAdded++;
        try {
          let eps = (data.unifiedSeries[aks.rawId] && data.unifiedSeries[aks.rawId].videos)
            ? data.unifiedSeries[aks.rawId].videos
            : null;

          if (!eps) {
            eps = await getAkwamSeriesEpisodes(aks.href);
          }
          if (!eps || eps.length === 0) return;

          const seriesId = aks.id;
          const videos = eps.map(e => ({
            id: `${seriesId}:1:${e.episode}:${e.id || e.vid}`,
            title: `الحلقة ${e.episode}`,
            season: 1,
            episode: e.episode,
            vid: e.id || e.vid,
            href: e.href
          }));

          for (const e of eps) {
            const epVid = e.id || e.vid;
            const srvObj = [{
              server: 1,
              label: 'سيرفر أكوام (MP4)',
              embed: e.href,
              source: 'akwam'
            }];
            data.servers[epVid] = srvObj;
            data.servers[e.href] = srvObj;
            data.epToSeries[epVid] = seriesId;
          }

          const seriesMetaObj = {
            id: seriesId,
            type: 'series',
            name: aks.name,
            poster: aks.poster,
            source: 'akwam',
            href: aks.href,
            videos
          };

          data.unifiedSeries[aks.rawId] = seriesMetaObj;
          data.unifiedSeries[seriesId] = seriesMetaObj;
          data.seriesMeta[aks.rawId] = videos;

          const catalogItem = {
            id: seriesId,
            type: 'series',
            name: aks.name,
            poster: aks.poster,
            source: 'akwam'
          };

          if (!data.series.some(s => s.id === seriesId)) {
            data.series.push(catalogItem);
            existingSeries.push({ item: catalogItem, norm: normalizeArabicTitle(aks.name), vid: aks.rawId });
          }

          const isForeignSeries = aks.section === 30 || /[a-zA-Z]{3,}/.test(aks.name);
          const isTurkishSeries = aks.section === 32 || /تركي/i.test(aks.name);
          const isDubbedSeries = /مدبلج/i.test(aks.name);

          if (isTurkishSeries && !data.turkish.some(s => s.id === seriesId)) {
            data.turkish.push(catalogItem);
          } else if (aks.category === 87 && !data.ramadan.some(s => s.id === seriesId)) {
            data.ramadan.push(catalogItem);
          } else if (isDubbedSeries && !data.dubbed_series.some(s => s.id === seriesId)) {
            data.dubbed_series.push(catalogItem);
          } else if (isForeignSeries && !data.foreign_series.some(s => s.id === seriesId)) {
            data.foreign_series.push(catalogItem);
          }
        } catch (_) {}
      }
    }, (done, total) => {
      if (done % 50 === 0 || done === total) {
        process.stdout.write(`  [Akwam Episodes] Ingested ${done}/${total} series...\r`);
        saveCompactData();
      }
    });

    console.log(`\nAkwam Series: ${akMatched} linked as backup servers, ${akAdded} new titles added.`);
    saveCompactData();
  } catch (e) {
    console.warn(`Error on Akwam deep ingestion: ${e.message}`);
  }

  // ==========================================
  // 4. WRITE FINAL METRICS & COMPACT SAVE
  // ==========================================
  console.log('\n====================================================');
  console.log('  FINAL ARCHIVE INGESTION METRICS');
  console.log('====================================================');
  console.log(`Total Movies: ${data.movies.length}`);
  console.log(`Total Series: ${data.series.length}`);
  console.log(`Total Egyptian Series: ${data.egyptian.length}`);
  console.log(`Total Syrian Series: ${data.syrian.length}`);
  console.log(`Total Gulf Series: ${data.gulf.length}`);
  console.log(`Total Turkish Series: ${data.turkish.length}`);
  console.log(`Total Ramadan Series: ${data.ramadan.length}`);
  console.log(`Total Foreign Movies: ${data.foreign_movies.length}`);
  console.log(`Total Foreign Series: ${data.foreign_series.length}`);
  console.log(`Total Dubbed Series: ${data.dubbed_series.length}`);
  console.log(`Total Cached Server Keys: ${Object.keys(data.servers).length}`);

  saveCompactData();
  console.log('Successfully saved compact initial_data.json!');
}

if (require.main === module) {
  runMerger().catch(console.error);
}

module.exports = { runMerger };
