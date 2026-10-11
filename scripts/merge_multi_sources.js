/**
 * High-Performance Multi-Source Catalog Merger & Backup Server Linker
 * Unifies Kirmalk + Akwam + WeCima into initial_data.json
 * Supports configurable page depth and concurrent episode extraction
 */

const fs = require('fs');
const path = require('path');
const { normalizeArabicTitle, titleSimilarity } = require('../sources/normalizer');
const {
  scrapeKirmalkSeries,
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

// Concurrency helper for parallel network requests
async function mapConcurrent(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkRes = await Promise.all(chunk.map(fn));
    results.push(...chunkRes);
  }
  return results;
}

async function runMerger(options = {}) {
  const isDeep = process.argv.includes('--deep') || options.deep;
  
  // Page limits: deep run crawls deeper; standard/daily run stays nimble
  const KIRMALK_SERIES_PAGES = options.kirmalkSeriesPages || (isDeep ? 15 : parseInt(process.env.KIRMALK_SERIES_PAGES || '4', 10));
  const KIRMALK_MOVIE_PAGES = options.kirmalkMoviePages || (isDeep ? 10 : parseInt(process.env.KIRMALK_MOVIE_PAGES || '3', 10));
  const AKWAM_SERIES_PAGES = options.akwamSeriesPages || (isDeep ? 12 : parseInt(process.env.AKWAM_SERIES_PAGES || '4', 10));
  const AKWAM_MOVIE_PAGES = options.akwamMoviePages || (isDeep ? 10 : parseInt(process.env.AKWAM_MOVIE_PAGES || '3', 10));
  const WECIMA_PAGES = options.wecimaPages || (isDeep ? 6 : parseInt(process.env.WECIMA_PAGES || '2', 10));

  console.log('====================================================');
  console.log('  STARTING MULTI-SOURCE MERGER (KIRMALK + AKWAM + WECIMA)');
  console.log(`  Mode: ${isDeep ? 'DEEP INGESTION' : 'STANDARD / INCREMENTAL'}`);
  console.log(`  Configured Pages: Kirmalk S:${KIRMALK_SERIES_PAGES}/M:${KIRMALK_MOVIE_PAGES} | Akwam S:${AKWAM_SERIES_PAGES}/M:${AKWAM_MOVIE_PAGES} | WeCima:${WECIMA_PAGES}`);
  console.log('====================================================');

  if (!fs.existsSync(INITIAL_DATA_FILE)) {
    console.error('initial_data.json not found!');
    return;
  }

  const data = JSON.parse(fs.readFileSync(INITIAL_DATA_FILE, 'utf8'));

  // Ensure all category arrays and index maps exist
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

  console.log(`Existing Catalog: ${data.movies.length} movies, ${data.series.length} series, ${Object.keys(data.servers).length} server keys.`);

  // Lookup maps by normalized title for fuzzy matching
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

  // ==========================================
  // 1. SCRAPE & MERGE KIRMALK
  // ==========================================
  console.log('\n--- 1. Fetching Kirmalk Content ---');
  try {
    const kirmalkSeries = await scrapeKirmalkSeries(KIRMALK_SERIES_PAGES);
    const kirmalkMovies = await scrapeKirmalkMovies(KIRMALK_MOVIE_PAGES);
    console.log(`Kirmalk scraped: ${kirmalkSeries.length} series, ${kirmalkMovies.length} movies.`);

    // Merge Kirmalk Movies
    let kmMoviesAdded = 0;
    for (const km of kirmalkMovies) {
      if (!data.movies.some(m => m.id === km.id || m.rawId === km.rawId)) {
        kmMoviesAdded++;
        data.movies.push(km);
        existingMovies.push({ item: km, norm: normalizeArabicTitle(km.name), vid: km.rawId });

        // Add default server entry
        data.servers[km.rawId] = [{
          server: 1,
          label: 'سيرفر كرمالك الرئيسي',
          embed: km.href,
          source: 'kirmalk'
        }];
        data.servers[km.id] = data.servers[km.rawId];
      }
    }
    console.log(`Kirmalk Movies: ${kmMoviesAdded} new movies added.`);

    // Merge Kirmalk Series
    const newKmSeries = kirmalkSeries.filter(ks => !data.series.some(s => s.id === ks.id || s.rawId === ks.rawId));
    console.log(`Kirmalk Series: ${newKmSeries.length} new series to ingest...`);

    // Ingest new Kirmalk series with episodes (chunked concurrency)
    await mapConcurrent(newKmSeries, 6, async (ks) => {
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

        if (/تركي/i.test(ks.name) && !data.turkish.some(s => s.id === seriesId)) {
          data.turkish.push(catalogItem);
        } else if (/رمضان/i.test(ks.name) && !data.ramadan.some(s => s.id === seriesId)) {
          data.ramadan.push(catalogItem);
        }
      } catch (err) {
        console.warn(`[Kirmalk] Error ingesting series ${ks.name}: ${err.message}`);
      }
    });
    console.log(`Kirmalk Series: finished processing.`);
  } catch (err) {
    console.warn(`[Kirmalk] Failed step: ${err.message}`);
  }

  // ==========================================
  // 2. SCRAPE & MERGE AKWAM
  // ==========================================
  console.log('\n--- 2. Fetching Akwam Content ---');
  try {
    const akwamArabicMovies = await scrapeAkwamMovies(29, AKWAM_MOVIE_PAGES);
    const akwamForeignMovies = await scrapeAkwamMovies(30, AKWAM_MOVIE_PAGES);
    const akwamGeneralSeries = await scrapeAkwamSeries(null, null, AKWAM_SERIES_PAGES);
    const akwamTurkishSeries = await scrapeAkwamSeries(32, null, Math.max(1, Math.floor(AKWAM_SERIES_PAGES / 2)));
    const akwamRamadanSeries = await scrapeAkwamSeries(0, 87, 1);

    console.log(`Akwam scraped: ${akwamArabicMovies.length + akwamForeignMovies.length} movies, ${akwamGeneralSeries.length + akwamTurkishSeries.length + akwamRamadanSeries.length} series.`);

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
        data.servers[akm.id] = data.servers[akm.rawId];
      }
    }
    console.log(`Akwam Movies: ${akwamMoviesMatched} matched as backup servers, ${akwamMoviesAdded} new movies added.`);

    // Merge Akwam Series
    const allAkwamSeries = [...akwamGeneralSeries, ...akwamTurkishSeries, ...akwamRamadanSeries];
    // Deduplicate series by ID
    const uniqueAkwamSeries = [];
    const seenAkIds = new Set();
    for (const s of allAkwamSeries) {
      if (!seenAkIds.has(s.id)) {
        seenAkIds.add(s.id);
        uniqueAkwamSeries.push(s);
      }
    }

    console.log(`Processing ${uniqueAkwamSeries.length} unique Akwam series...`);

    let akwamSeriesMatched = 0;
    let akwamSeriesAdded = 0;

    await mapConcurrent(uniqueAkwamSeries, 6, async (aks) => {
      const match = findSeriesMatch(aks.name);
      if (match) {
        akwamSeriesMatched++;
        // Attach Akwam backup servers to existing show
        try {
          const unified = data.unifiedSeries[match.vid] || data.unifiedSeries[`km_s_${match.vid}`];
          if (unified && unified.videos) {
            // Check if backup servers already attached to episode 1
            const ep1Vid = unified.videos[0]?.vid;
            const alreadyHasAkwam = ep1Vid && (data.servers[ep1Vid] || []).some(s => s.source === 'akwam');
            if (!alreadyHasAkwam) {
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
        // Brand new Akwam series
        akwamSeriesAdded++;
        try {
          // If already in unifiedSeries with videos, skip re-fetching
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
        } catch (err) {
          console.warn(`[Akwam] Failed adding series ${aks.name}: ${err.message}`);
        }
      }
    });

    console.log(`Akwam Series: ${akwamSeriesMatched} matched as backup servers, ${akwamSeriesAdded} new series added.`);
  } catch (err) {
    console.warn(`[Akwam] Failed step: ${err.message}`);
  }

  // ==========================================
  // 3. SCRAPE & MERGE WECIMA
  // ==========================================
  console.log('\n--- 3. Fetching WeCima Content ---');
  try {
    const wecimaArabicMovies = await scrapeWeCimaMovies('افلام-عربي', WECIMA_PAGES);
    const wecimaForeignMovies = await scrapeWeCimaMovies('افلام-اجنبي', WECIMA_PAGES);
    const wecimaTurkishMovies = await scrapeWeCimaMovies('افلام-تركية', WECIMA_PAGES);

    const wecimaArabicSeries = await scrapeWeCimaSeries('مسلسلات-عربي', WECIMA_PAGES);
    const wecimaTurkishSeries = await scrapeWeCimaSeries('مسلسلات-تركية', WECIMA_PAGES);
    const wecimaDubbedSeries = await scrapeWeCimaSeries('مسلسلات-مدبلجة', WECIMA_PAGES);
    const wecimaForeignSeries = await scrapeWeCimaSeries('مسلسلات-اجنبي', WECIMA_PAGES);

    console.log(`WeCima scraped: ${wecimaArabicMovies.length + wecimaForeignMovies.length + wecimaTurkishMovies.length} movies, ${wecimaArabicSeries.length + wecimaTurkishSeries.length + wecimaDubbedSeries.length + wecimaForeignSeries.length} series.`);

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
        data.servers[wcm.href] = srvObj;
      }
    }
    console.log(`WeCima Movies: ${wecimaMoviesMatched} matched as backup servers, ${wecimaMoviesAdded} new movies added.`);

    // Merge WeCima Series
    const allWeCimaSeries = [...wecimaArabicSeries, ...wecimaTurkishSeries, ...wecimaDubbedSeries, ...wecimaForeignSeries];
    const uniqueWeCimaSeries = [];
    const seenWcIds = new Set();
    for (const s of allWeCimaSeries) {
      if (!seenWcIds.has(s.id)) {
        seenWcIds.add(s.id);
        uniqueWeCimaSeries.push(s);
      }
    }

    console.log(`Processing ${uniqueWeCimaSeries.length} unique WeCima series...`);

    let wecimaSeriesMatched = 0;
    let wecimaSeriesAdded = 0;

    await mapConcurrent(uniqueWeCimaSeries, 6, async (wcs) => {
      const match = findSeriesMatch(wcs.name);
      if (match) {
        wecimaSeriesMatched++;
        try {
          const unified = data.unifiedSeries[match.vid] || data.unifiedSeries[`km_s_${match.vid}`];
          if (unified && unified.videos) {
            const ep1Vid = unified.videos[0]?.vid;
            const alreadyHasWecima = ep1Vid && (data.servers[ep1Vid] || []).some(s => s.source === 'wecima');
            if (!alreadyHasWecima) {
              const eps = await getWeCimaSeriesEpisodes(wcs.href, wcs.sampleEpHref);
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
          }
        } catch (_) {}
      } else {
        wecimaSeriesAdded++;
        try {
          let eps = (data.unifiedSeries[wcs.rawId] && data.unifiedSeries[wcs.rawId].videos)
            ? data.unifiedSeries[wcs.rawId].videos
            : null;

          if (!eps) {
            eps = await getWeCimaSeriesEpisodes(wcs.href, wcs.sampleEpHref);
          }
          if (!eps || eps.length === 0) return;

          const seriesId = wcs.id;
          const videos = eps.map(e => {
            const epSlug = e.href.split('/').filter(Boolean).pop();
            let cleanEpSlug = epSlug;
            try { cleanEpSlug = decodeURIComponent(epSlug); } catch (_) {}
            return {
              id: `${seriesId}:1:${e.episode}:${cleanEpSlug}`,
              title: `الحلقة ${e.episode}`,
              season: 1,
              episode: e.episode,
              vid: cleanEpSlug,
              href: e.href
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
            const rawSlug = e.href.split('/').filter(Boolean).pop();
            data.servers[rawSlug] = srvObj;
            try {
              data.servers[decodeURIComponent(rawSlug)] = srvObj;
              data.servers[encodeURIComponent(v.vid)] = srvObj;
            } catch (_) {}
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
          try {
            data.unifiedSeries[encodeURIComponent(wcs.rawId)] = seriesMetaObj;
          } catch (_) {}
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
          } else if (wcs.category === 'مسلسلات-اجنبي' && !data.foreign_series.some(s => s.id === seriesId)) {
            data.foreign_series.push(catalogItem);
          }
        } catch (err) {
          console.warn(`[WeCima] Failed adding series ${wcs.name}: ${err.message}`);
        }
      }
    });

    console.log(`WeCima Series: ${wecimaSeriesMatched} matched as backup servers, ${wecimaSeriesAdded} new series added.`);
  } catch (err) {
    console.warn(`[WeCima] Failed step: ${err.message}`);
  }

  // ==========================================
  // 4. WRITE CONSOLIDATED INITIAL_DATA.JSON
  // ==========================================
  console.log('\n--- Final Ingestion Metrics ---');
  console.log(`Total Movies: ${data.movies.length}`);
  console.log(`Total Series: ${data.series.length}`);
  console.log(`Total Turkish Series: ${data.turkish.length}`);
  console.log(`Total Foreign Movies: ${data.foreign_movies.length}`);
  console.log(`Total Foreign Series: ${data.foreign_series.length}`);
  console.log(`Total Dubbed Series: ${data.dubbed_series.length}`);
  console.log(`Total Cached Server Keys: ${Object.keys(data.servers).length}`);

  fs.writeFileSync(INITIAL_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log('Successfully written initial_data.json!');
}

if (require.main === module) {
  runMerger().catch(console.error);
}

module.exports = { runMerger };
