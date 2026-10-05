/**
 * Multi-Source Catalog Merger & Backup Server Linker
 * Combines Kirmalk + Akwam + WeCima into initial_data.json
 */

const fs = require('fs');
const path = require('path');
const { normalizeArabicTitle, titleSimilarity } = require('../sources/normalizer');
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

async function runMerger() {
  console.log('====================================================');
  console.log('  STARTING MULTI-SOURCE MERGER (AKWAM + WECIMA)');
  console.log('====================================================');

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

  console.log(`Starting with: ${data.movies.length} movies, ${data.series.length} unified series.`);

  // Create lookup map of existing movies by normalized title
  const existingMovies = [];
  for (const m of data.movies) {
    existingMovies.push({
      item: m,
      norm: normalizeArabicTitle(m.name),
      vid: m.id.replace(/^km_m_/, '')
    });
  }

  // Create lookup map of existing series by normalized title
  const existingSeries = [];
  for (const s of data.series) {
    existingSeries.push({
      item: s,
      norm: normalizeArabicTitle(s.name),
      vid: s.id.replace(/^km_s_/, '')
    });
  }

  // Helper to find matching movie
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

  // Helper to find matching series
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

  // ==========================================
  // 1. SCRAPE & MERGE AKWAM
  // ==========================================
  console.log('\n--- 1. Fetching Akwam Content ---');

  // Akwam Arabic Movies (Section 29)
  console.log('Fetching Akwam Arabic Movies...');
  const akwamArabicMovies = await scrapeAkwamMovies(29, 2);
  // Akwam Foreign Movies (Section 30)
  console.log('Fetching Akwam Foreign Movies...');
  const akwamForeignMovies = await scrapeAkwamMovies(30, 2);

  // Akwam Arabic Series (Section 29)
  console.log('Fetching Akwam Arabic Series...');
  const akwamArabicSeries = await scrapeAkwamSeries(29, null, 2);
  // Akwam Turkish Series (Section 32)
  console.log('Fetching Akwam Turkish Series...');
  const akwamTurkishSeries = await scrapeAkwamSeries(32, null, 2);
  // Akwam Ramadan Series (Section 0, Category 87)
  console.log('Fetching Akwam Ramadan Series...');
  const akwamRamadanSeries = await scrapeAkwamSeries(0, 87, 1);

  console.log(`Akwam scraped: ${akwamArabicMovies.length + akwamForeignMovies.length} movies, ${akwamArabicSeries.length + akwamTurkishSeries.length + akwamRamadanSeries.length} series.`);

  // Merge Akwam Movies
  let akwamMoviesMatched = 0;
  let akwamMoviesAdded = 0;

  for (const akm of [...akwamArabicMovies, ...akwamForeignMovies]) {
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
      const isForeign = akm.section === 30;
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
    }
  }
  console.log(`Akwam Movies: ${akwamMoviesMatched} linked as backup servers, ${akwamMoviesAdded} new titles added.`);

  // Merge Akwam Series
  let akwamSeriesMatched = 0;
  let akwamSeriesAdded = 0;

  const allAkwamSeries = [...akwamArabicSeries, ...akwamTurkishSeries, ...akwamRamadanSeries];
  for (const aks of allAkwamSeries) {
    const match = findSeriesMatch(aks.name);
    if (match) {
      akwamSeriesMatched++;
      // Fetch episodes to attach backup servers
      try {
        const eps = await getAkwamSeriesEpisodes(aks.href);
        const unified = data.unifiedSeries[match.vid] || data.unifiedSeries[`km_s_${match.vid}`];
        if (unified && unified.videos) {
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
      } catch (_) {}
    } else {
      akwamSeriesAdded++;
      try {
        const eps = await getAkwamSeriesEpisodes(aks.href);
        if (eps.length === 0) continue;

        const seriesId = aks.id;
        const videos = eps.map(e => ({
          id: `${seriesId}:1:${e.episode}:${e.id}`,
          title: `الحلقة ${e.episode}`,
          season: 1,
          episode: e.episode,
          vid: e.id
        }));

        for (const e of eps) {
          data.servers[e.id] = [{
            server: 1,
            label: 'سيرفر أكوام (MP4)',
            embed: e.href,
            source: 'akwam'
          }];
          data.epToSeries[e.id] = seriesId;
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

        if (aks.section === 32 && !data.turkish.some(s => s.id === seriesId)) {
          data.turkish.push(catalogItem);
        } else if (aks.category === 87 && !data.ramadan.some(s => s.id === seriesId)) {
          data.ramadan.push(catalogItem);
        }
      } catch (err) {
        console.warn(`Failed adding Akwam series ${aks.name}: ${err.message}`);
      }
    }
  }
  console.log(`Akwam Series: ${akwamSeriesMatched} linked as backup servers, ${akwamSeriesAdded} new series added.`);

  // ==========================================
  // 2. SCRAPE & MERGE WECIMA
  // ==========================================
  console.log('\n--- 2. Fetching WeCima Content ---');

  // WeCima Arabic Movies
  console.log('Fetching WeCima Arabic Movies...');
  const wecimaArabicMovies = await scrapeWeCimaMovies('افلام-عربي', 2);
  // WeCima Foreign Movies
  console.log('Fetching WeCima Foreign Movies...');
  const wecimaForeignMovies = await scrapeWeCimaMovies('افلام-اجنبي', 2);
  // WeCima Turkish Movies
  console.log('Fetching WeCima Turkish Movies...');
  const wecimaTurkishMovies = await scrapeWeCimaMovies('افلام-تركية', 2);

  // WeCima Arabic Series
  console.log('Fetching WeCima Arabic Series...');
  const wecimaArabicSeries = await scrapeWeCimaSeries('مسلسلات-عربي', 2);
  // WeCima Turkish Series
  console.log('Fetching WeCima Turkish Series...');
  const wecimaTurkishSeries = await scrapeWeCimaSeries('مسلسلات-تركية', 2);
  // WeCima Dubbed Series
  console.log('Fetching WeCima Dubbed Series...');
  const wecimaDubbedSeries = await scrapeWeCimaSeries('مسلسلات-مدبلجة', 2);

  console.log(`WeCima scraped: ${wecimaArabicMovies.length + wecimaForeignMovies.length + wecimaTurkishMovies.length} movies, ${wecimaArabicSeries.length + wecimaTurkishSeries.length + wecimaDubbedSeries.length} series.`);

  // Merge WeCima Movies
  let wecimaMoviesMatched = 0;
  let wecimaMoviesAdded = 0;

  for (const wcm of [...wecimaArabicMovies, ...wecimaForeignMovies, ...wecimaTurkishMovies]) {
    const match = findMovieMatch(wcm.name);
    if (match) {
      wecimaMoviesMatched++;
      const vid = match.vid;
      data.servers[vid] = data.servers[vid] || [];
      if (!data.servers[vid].some(s => s.source === 'wecima')) {
        data.servers[vid].push({
          server: 3,
          label: 'سيرفر وي سيما (HD HLS)',
          embed: wcm.href,
          source: 'wecima'
        });
      }
    } else {
      wecimaMoviesAdded++;
      const isForeign = wcm.category === 'افلام-اجنبي';
      const isTurkish = wcm.category === 'افلام-تركية';

      const newItem = {
        id: wcm.id,
        type: 'movie',
        name: wcm.name,
        poster: wcm.poster,
        source: 'wecima',
        href: wcm.href
      };

      if (!data.movies.some(m => m.id === wcm.id)) {
        data.movies.push(newItem);
        existingMovies.push({ item: newItem, norm: normalizeArabicTitle(wcm.name), vid: wcm.rawId });
      }

      if (isForeign && !data.foreign_movies.some(m => m.id === wcm.id)) {
        data.foreign_movies.push(newItem);
      }

      const srvObj = [{
        server: 1,
        label: 'سيرفر وي سيما (HD HLS)',
        embed: wcm.href,
        source: 'wecima'
      }];
      data.servers[wcm.id] = srvObj;
      data.servers[wcm.rawId] = srvObj;
    }
  }
  console.log(`WeCima Movies: ${wecimaMoviesMatched} linked as backup servers, ${wecimaMoviesAdded} new titles added.`);

  // Merge WeCima Series
  let wecimaSeriesMatched = 0;
  let wecimaSeriesAdded = 0;

  const allWeCimaSeries = [...wecimaArabicSeries, ...wecimaTurkishSeries, ...wecimaDubbedSeries];
  for (const wcs of allWeCimaSeries) {
    const match = findSeriesMatch(wcs.name);
    if (match) {
      wecimaSeriesMatched++;
      try {
        const eps = await getWeCimaSeriesEpisodes(wcs.href, wcs.sampleEpHref);
        const unified = data.unifiedSeries[match.vid] || data.unifiedSeries[`km_s_${match.vid}`];
        if (unified && unified.videos) {
          for (const ep of eps) {
            const uEp = unified.videos.find(v => v.episode === ep.episode);
            if (uEp && uEp.vid) {
              data.servers[uEp.vid] = data.servers[uEp.vid] || [];
              if (!data.servers[uEp.vid].some(s => s.source === 'wecima')) {
                data.servers[uEp.vid].push({
                  server: 3,
                  label: 'سيرفر وي سيما (HD HLS)',
                  embed: ep.href,
                  source: 'wecima'
                });
              }
            }
          }
        }
      } catch (_) {}
    } else {
      wecimaSeriesAdded++;
      try {
        const eps = await getWeCimaSeriesEpisodes(wcs.href, wcs.sampleEpHref);
        if (eps.length === 0) continue;

        const seriesId = wcs.id;
        const videos = eps.map(e => {
          const epSlug = e.href.split('/').filter(Boolean).pop();
          return {
            id: `${seriesId}:1:${e.episode}:${epSlug}`,
            title: `الحلقة ${e.episode}`,
            season: 1,
            episode: e.episode,
            vid: epSlug
          };
        });

        for (let i = 0; i < eps.length; i++) {
          const e = eps[i];
          const v = videos[i];
          const srvObj = [{
            server: 1,
            label: 'سيرفر وي سيما (HD HLS)',
            embed: e.href,
            source: 'wecima'
          }];
          data.servers[v.vid] = srvObj;
          data.servers[e.href] = srvObj;
          data.epToSeries[v.vid] = seriesId;
        }

        const seriesMetaObj = {
          id: seriesId,
          type: 'series',
          name: wcs.name,
          poster: wcs.poster,
          source: 'wecima',
          href: wcs.href,
          videos
        };

        data.unifiedSeries[wcs.rawId] = seriesMetaObj;
        data.unifiedSeries[seriesId] = seriesMetaObj;
        data.seriesMeta[wcs.rawId] = videos;

        const catalogItem = {
          id: seriesId,
          type: 'series',
          name: wcs.name,
          poster: wcs.poster,
          source: 'wecima'
        };

        if (!data.series.some(s => s.id === seriesId)) {
          data.series.push(catalogItem);
          existingSeries.push({ item: catalogItem, norm: normalizeArabicTitle(wcs.name), vid: wcs.rawId });
        }

        if (wcs.category === 'مسلسلات-تركية' && !data.turkish.some(s => s.id === seriesId)) {
          data.turkish.push(catalogItem);
        } else if (wcs.category === 'مسلسلات-مدبلجة' && !data.dubbed_series.some(s => s.id === seriesId)) {
          data.dubbed_series.push(catalogItem);
        }
      } catch (err) {
        console.warn(`Failed adding WeCima series ${wcs.name}: ${err.message}`);
      }
    }
  }
  console.log(`WeCima Series: ${wecimaSeriesMatched} linked as backup servers, ${wecimaSeriesAdded} new series added.`);

  // ==========================================
  // 3. WRITE CONSOLIDATED INITIAL_DATA.JSON
  // ==========================================
  console.log('\n--- Writing Updated initial_data.json ---');
  console.log(`Total Movies: ${data.movies.length}`);
  console.log(`Total Series: ${data.series.length}`);
  console.log(`Total Turkish Series: ${data.turkish.length}`);
  console.log(`Total Foreign Movies: ${data.foreign_movies.length}`);
  console.log(`Total Dubbed Series: ${data.dubbed_series.length}`);
  console.log(`Total Cached Server Keys: ${Object.keys(data.servers).length}`);

  fs.writeFileSync(INITIAL_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log('Successfully written initial_data.json!');
}

if (require.main === module) {
  runMerger().catch(console.error);
}

module.exports = { runMerger };
