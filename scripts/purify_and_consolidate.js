/**
 * Purify Catalog & Consolidate Series Script
 * 1. Purges all series episodes mistakenly stored in data.movies / data.foreign_movies
 * 2. Reconstructs each series with all its episodes and working stream servers
 * 3. Crawls Kirmalk search to gather any missing episodes for these series
 * 4. Merges duplicate series ("مسلسل X" vs "X") and duplicate movies, combining episodes & servers
 * 5. Purges fake watch.php embeds from data.servers so native streams always work
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const { normalizeArabicTitle, titleSimilarity } = require('../sources/normalizer');
const { extractKirmalkServers, BASE_URL } = require('../sources/kirmalk');
const { scrapeSearch } = require('../scraper');

const INITIAL_DATA_FILE = path.join(__dirname, '../initial_data.json');

const arNumbers = {
  'الاولى': 1, 'الاولي': 1, 'الاول': 1,
  'الثانية': 2, 'التانية': 2, 'الثاني': 2,
  'الثالثة': 3, 'التالتة': 3, 'الثالث': 3,
  'الرابعة': 4, 'الرابع': 4,
  'الخامسة': 5, 'الخامس': 5,
  'السادسة': 6, 'السادس': 6,
  'السابعة': 7, 'السابع': 7,
  'الثامنة': 8, 'التامنة': 8, 'الثامن': 8,
  'التاسعة': 9, 'التاسع': 9,
  'العاشرة': 10, 'العاشر': 10,
  'الحادية عشر': 11, 'الحادية عشرة': 11,
  'الثانية عشر': 12, 'الثانية عشرة': 12,
  'الثالثة عشر': 13, 'الرابعة عشر': 14,
  'الخامسة عشر': 15, 'السادسة عشر': 16,
  'السابعة عشر': 17, 'الثامنة عشر': 18,
  'التاسعة عشر': 19, 'العشرون': 20,
  'الحادية والعشرون': 21, 'الحادية و العشرون': 21,
  'الثانية والعشرون': 22, 'الثانية و العشرون': 22,
  'الثالثة والعشرون': 23, 'الثالثة و العشرون': 23,
  'الرابعة والعشرون': 24, 'الرابعة و العشرون': 24,
  'الخامسة والعشرون': 25, 'الخامسة و العشرون': 25,
  'السادسة والعشرون': 26, 'السادسة و العشرون': 26,
  'السابعة والعشرون': 27, 'السابعة و العشرون': 27,
  'الثامنة والعشرون': 28, 'الثامنة و العشرون': 28,
  'التاسعة والعشرون': 29, 'التاسعة و العشرون': 29,
  'الثلاثون': 30
};

function parseEpisodeNum(title) {
  const numMatch = title.match(/الحلق[ةه]\s*(\d+)/i) || title.match(/حلق[ةه]\s*(\d+)/i);
  if (numMatch) return parseInt(numMatch[1], 10);
  for (const [word, val] of Object.entries(arNumbers)) {
    if (title.includes(word)) return val;
  }
  return 1;
}

function extractSeriesInfo(title) {
  let cleaned = title
    .replace(/^الانمي\s+/i, '')
    .replace(/^مسلسل\s+/i, '')
    .replace(/الحلق[ةه]\s*(\d+|[^\s]+).*$/gi, '')
    .replace(/حلق[ةه]\s*(\d+|[^\s]+).*$/gi, '')
    .replace(/\b(HD|720p|1080p|FHD|مترجم|مدبلج|مدبلجة|مترجمة|كاملة|اون لاين|شاهد|والاخيرة|الاخيرة)\b/gi, '')
    .replace(/[\(\)\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const isAnime = /انمي|أنمي|بوروتو|boruto/i.test(title);
  const prefix = isAnime ? 'انمي ' : 'مسلسل ';
  const seriesName = prefix + cleaned;

  return {
    seriesName,
    cleanName: cleaned,
    isAnime
  };
}

async function mapConcurrent(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkRes = await Promise.all(chunk.map(fn));
    results.push(...chunkRes);
  }
  return results;
}

async function runPurifyAndConsolidate() {
  console.log('====================================================');
  console.log('  STARTING CATALOG PURIFICATION & SERIES CONSOLIDATION');
  console.log('====================================================');

  if (!fs.existsSync(INITIAL_DATA_FILE)) {
    console.error('initial_data.json not found!');
    return;
  }

  const data = JSON.parse(fs.readFileSync(INITIAL_DATA_FILE, 'utf8'));

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
  data.unifiedSeries = data.unifiedSeries || {};
  data.epToSeries = data.epToSeries || {};

  console.log(`Initial state: ${data.movies.length} movies, ${data.series.length} series, ${Object.keys(data.servers).length} server keys.`);

  // ----------------------------------------------------
  // STEP 1: Purge Fake watch.php Embeds from data.servers
  // ----------------------------------------------------
  console.log('\n--- 1. Purging Fake watch.php Embeds from Cache ---');
  let purgedEmbeds = 0;
  for (const [key, srvs] of Object.entries(data.servers)) {
    if (Array.isArray(srvs)) {
      const validSrvs = srvs.filter(s => {
        if (!s || !s.embed) return false;
        if (s.embed.includes('watch.php')) {
          purgedEmbeds++;
          return false;
        }
        // Unwrap iframe string if needed
        if (s.embed.includes('<iframe') || s.embed.includes('<IFRAME')) {
          const m = s.embed.match(/src=["']([^"']+)["']/i);
          if (m) s.embed = m[1];
        }
        return true;
      });

      if (validSrvs.length > 0) {
        data.servers[key] = validSrvs;
      } else {
        delete data.servers[key];
      }
    }
  }
  console.log(`Purged ${purgedEmbeds} invalid watch.php placeholder embeds.`);
  console.log(`Remaining server keys with verified streams: ${Object.keys(data.servers).length}`);

  // ----------------------------------------------------
  // STEP 2: Identify & Extract Episodes Mistakenly in Movies
  // ----------------------------------------------------
  console.log('\n--- 2. Extracting Series Episodes from Movies Catalog ---');
  const epRegex = /(مسلسل|الحلق[ةه]|حلق[ةه]\s*\d+|S\d+E\d+)/i;
  const legitimateMovies = [];
  const episodesToConsolidate = [];

  for (const m of data.movies) {
    const isSpecialMovie = m.name.includes('مباراة') || m.name.includes('وراء الكواليس');
    if (!isSpecialMovie && epRegex.test(m.name)) {
      episodesToConsolidate.push(m);
    } else {
      legitimateMovies.push(m);
    }
  }

  data.movies = legitimateMovies;
  data.foreign_movies = (data.foreign_movies || []).filter(fm => !episodesToConsolidate.some(ep => ep.id === fm.id));

  console.log(`Identified ${episodesToConsolidate.length} episode items to relocate to Series.`);
  console.log(`Cleaned Movies catalog: ${data.movies.length} legitimate movies.`);

  // ----------------------------------------------------
  // STEP 3: Group Episodes by Series & Search for Additional Episodes
  // ----------------------------------------------------
  console.log('\n--- 3. Grouping Episodes by Series & Enriching Episode Lists ---');
  const seriesGroups = new Map();

  for (const ep of episodesToConsolidate) {
    const { seriesName, cleanName } = extractSeriesInfo(ep.name);
    const epNum = parseEpisodeNum(ep.name);
    const vid = ep.rawId || ep.id.replace(/^(km|ak|wc)_[ms]_?/, '');

    if (!seriesGroups.has(seriesName)) {
      seriesGroups.set(seriesName, {
        seriesName,
        cleanName,
        poster: ep.poster,
        episodes: new Map()
      });
    }

    const group = seriesGroups.get(seriesName);
    if (!group.poster && ep.poster) group.poster = ep.poster;

    group.episodes.set(epNum, {
      episode: epNum,
      vid,
      href: ep.href || `https://kirmalk.com/watch.php?vid=${vid}`,
      title: `الحلقة ${epNum}`
    });
  }

  console.log(`Discovered ${seriesGroups.size} distinct series from extracted episodes.`);

  // Search Kirmalk to gather missing episodes for each discovered series
  for (const [sName, group] of seriesGroups.entries()) {
    console.log(`Searching Kirmalk for additional episodes of "${sName}"...`);
    try {
      const searchTerms = [group.cleanName];
      for (const term of searchTerms) {
        for (let p = 1; p <= 4; p++) {
          const results = await scrapeSearch(term, p);
          if (!results || results.length === 0) break;

          for (const item of results) {
            const vid = item.id.replace(/^(km|ak|wc)_[ms]_?/, '');
            const itemEpNum = parseEpisodeNum(item.name);
            const itemSeriesInfo = extractSeriesInfo(item.name);

            // Match if belongs to same series/part
            if (normalizeArabicTitle(itemSeriesInfo.seriesName) === normalizeArabicTitle(sName)) {
              if (!group.episodes.has(itemEpNum)) {
                group.episodes.set(itemEpNum, {
                  episode: itemEpNum,
                  vid,
                  href: `https://kirmalk.com/watch.php?vid=${vid}`,
                  title: `الحلقة ${itemEpNum}`
                });
              }
              if (!group.poster && item.poster) group.poster = item.poster;
            }
          }
        }
      }
      console.log(`  -> "${sName}" now has ${group.episodes.size} episodes.`);
    } catch (err) {
      console.warn(`  Search note for ${sName}: ${err.message}`);
    }
  }

  // ----------------------------------------------------
  // STEP 4: Fetch Stream Servers for All Consolidated Episodes
  // ----------------------------------------------------
  console.log('\n--- 4. Extracting Working Stream Servers for Episodes ---');
  let extractedServerCount = 0;

  for (const [sName, group] of seriesGroups.entries()) {
    const episodeList = Array.from(group.episodes.values());
    console.log(`Extracting servers for ${episodeList.length} episodes of "${sName}"...`);

    await mapConcurrent(episodeList, 6, async (ep) => {
      try {
        if (!data.servers[ep.vid] || data.servers[ep.vid].length === 0) {
          const srvs = await extractKirmalkServers(ep.vid);
          if (srvs && srvs.length > 0) {
            data.servers[ep.vid] = srvs;
            data.servers[ep.href] = srvs;
            extractedServerCount++;
          }
        }
      } catch (_) {}
    });
  }
  console.log(`Extracted working stream servers for ${extractedServerCount} newly consolidated episodes.`);

  // ----------------------------------------------------
  // STEP 5: Merge Consolidated Series into Catalog
  // ----------------------------------------------------
  console.log('\n--- 5. Integrating Consolidated Series into Catalog ---');

  for (const [sName, group] of seriesGroups.entries()) {
    const norm = normalizeArabicTitle(sName);
    const existingSeries = data.series.find(s => normalizeArabicTitle(s.name) === norm);
    const sortedEps = Array.from(group.episodes.values()).sort((a, b) => a.episode - b.episode);

    if (existingSeries) {
      console.log(`Merging into existing series: "${existingSeries.name}" (${existingSeries.id})`);
      const seriesId = existingSeries.id;
      const rawVid = seriesId.replace(/^(km|ak|wc)_[ms]_?/, '');
      const unified = data.unifiedSeries[seriesId] || data.unifiedSeries[rawVid] || {
        id: seriesId,
        type: 'series',
        name: existingSeries.name,
        poster: existingSeries.poster || group.poster,
        videos: []
      };

      const existingVideos = unified.videos || [];
      const epMap = new Map();
      for (const v of existingVideos) epMap.set(v.episode, v);

      for (const ep of sortedEps) {
        if (!epMap.has(ep.episode)) {
          const newVid = {
            id: `${seriesId}:1:${ep.episode}:${ep.vid}`,
            title: `الحلقة ${ep.episode}`,
            season: 1,
            episode: ep.episode,
            vid: ep.vid,
            href: ep.href
          };
          epMap.set(ep.episode, newVid);
          data.epToSeries[ep.vid] = seriesId;
        }
      }

      const mergedVideos = Array.from(epMap.values()).sort((a, b) => a.episode - b.episode);
      unified.videos = mergedVideos;
      data.unifiedSeries[seriesId] = unified;
      data.unifiedSeries[rawVid] = unified;
    } else {
      console.log(`Creating new canonical series: "${sName}" with ${sortedEps.length} episodes.`);
      const canonicalVid = sortedEps[0]?.vid || Math.random().toString(36).substring(2, 9);
      const seriesId = `km_s_${canonicalVid}`;

      const videos = sortedEps.map(ep => ({
        id: `${seriesId}:1:${ep.episode}:${ep.vid}`,
        title: `الحلقة ${ep.episode}`,
        season: 1,
        episode: ep.episode,
        vid: ep.vid,
        href: ep.href
      }));

      for (const ep of sortedEps) {
        data.epToSeries[ep.vid] = seriesId;
      }

      const unifiedObj = {
        id: seriesId,
        type: 'series',
        name: sName,
        poster: group.poster,
        source: 'kirmalk',
        videos
      };

      data.unifiedSeries[seriesId] = unifiedObj;
      data.unifiedSeries[canonicalVid] = unifiedObj;

      const catalogItem = {
        id: seriesId,
        type: 'series',
        name: sName,
        poster: group.poster,
        source: 'kirmalk'
      };

      data.series.push(catalogItem);

      // Route to sub-genres
      if (/تركي/i.test(sName)) {
        data.turkish.push(catalogItem);
      } else if (/مصر/i.test(sName)) {
        data.egyptian.push(catalogItem);
      } else if (/شام|سور/i.test(sName)) {
        data.syrian.push(catalogItem);
      } else if (/خليج|كويت|سعود/i.test(sName)) {
        data.gulf.push(catalogItem);
      } else if (/رمضان/i.test(sName)) {
        data.ramadan.push(catalogItem);
      }
    }
  }

  // ----------------------------------------------------
  // STEP 6: Deduplicate Series ("مسلسل X" vs "X", Identical Titles)
  // ----------------------------------------------------
  console.log('\n--- 6. Deduplicating All Series (Merging Variants & Episodes) ---');
  const seriesByNorm = new Map();

  for (const s of data.series) {
    const norm = normalizeArabicTitle(s.name);
    if (!seriesByNorm.has(norm)) {
      seriesByNorm.set(norm, []);
    }
    seriesByNorm.get(norm).push(s);
  }

  const deduplicatedSeries = [];
  let seriesMergedCount = 0;

  for (const [norm, group] of seriesByNorm.entries()) {
    if (group.length === 1) {
      deduplicatedSeries.push(group[0]);
    } else {
      seriesMergedCount += (group.length - 1);

      // Pick canonical entry: prefer title starting with "مسلسل", then highest episode count
      let canonical = group[0];
      let maxEps = 0;

      for (const s of group) {
        const u = data.unifiedSeries[s.id] || data.unifiedSeries[s.id.replace(/^(km|ak|wc)_[ms]_?/, '')];
        const epsCount = u?.videos?.length || 0;
        if (s.name.startsWith('مسلسل ') && epsCount >= maxEps) {
          canonical = s;
          maxEps = epsCount;
        } else if (epsCount > maxEps) {
          canonical = s;
          maxEps = epsCount;
        }
      }

      // Merge all episodes from all duplicates into canonical
      const canonicalId = canonical.id;
      const canonicalRawVid = canonicalId.replace(/^(km|ak|wc)_[ms]_?/, '');
      const allVideosMap = new Map();

      for (const s of group) {
        const u = data.unifiedSeries[s.id] || data.unifiedSeries[s.id.replace(/^(km|ak|wc)_[ms]_?/, '')];
        if (u && u.videos) {
          for (const v of u.videos) {
            if (!allVideosMap.has(v.episode)) {
              allVideosMap.set(v.episode, {
                ...v,
                id: `${canonicalId}:1:${v.episode}:${v.vid}`
              });
            } else {
              // Combine servers if video ID differs
              const existingV = allVideosMap.get(v.episode);
              if (existingV.vid !== v.vid && data.servers[v.vid]) {
                data.servers[existingV.vid] = data.servers[existingV.vid] || [];
                for (const srv of data.servers[v.vid]) {
                  if (!data.servers[existingV.vid].some(x => x.embed === srv.embed)) {
                    data.servers[existingV.vid].push(srv);
                  }
                }
              }
            }
          }
        }
      }

      const mergedVideos = Array.from(allVideosMap.values()).sort((a, b) => a.episode - b.episode);
      const canonicalUnified = {
        id: canonicalId,
        type: 'series',
        name: canonical.name,
        poster: canonical.poster || group.find(x => x.poster)?.poster,
        source: canonical.source || 'kirmalk',
        videos: mergedVideos
      };

      data.unifiedSeries[canonicalId] = canonicalUnified;
      data.unifiedSeries[canonicalRawVid] = canonicalUnified;

      // Link all duplicate IDs to the canonical unified series
      for (const s of group) {
        data.unifiedSeries[s.id] = canonicalUnified;
        data.unifiedSeries[s.id.replace(/^(km|ak|wc)_[ms]_?/, '')] = canonicalUnified;
      }

      deduplicatedSeries.push(canonical);
    }
  }

  data.series = deduplicatedSeries;
  console.log(`Deduplicated series: merged ${seriesMergedCount} duplicate series entries.`);

  // ----------------------------------------------------
  // STEP 7: Deduplicate Movies & Subgenre Lists
  // ----------------------------------------------------
  console.log('\n--- 7. Deduplicating Movies & Categories ---');
  const moviesByNorm = new Map();
  for (const m of data.movies) {
    const norm = normalizeArabicTitle(m.name);
    if (!moviesByNorm.has(norm)) {
      moviesByNorm.set(norm, []);
    }
    moviesByNorm.get(norm).push(m);
  }

  const deduplicatedMovies = [];
  let moviesMergedCount = 0;

  for (const [norm, group] of moviesByNorm.entries()) {
    if (group.length === 1) {
      deduplicatedMovies.push(group[0]);
    } else {
      moviesMergedCount += (group.length - 1);
      const canonical = group[0];
      const canonicalVid = canonical.rawId || canonical.id.replace(/^(km|ak|wc)_[ms]_?/, '');
      data.servers[canonicalVid] = data.servers[canonicalVid] || [];

      for (const m of group.slice(1)) {
        const mVid = m.rawId || m.id.replace(/^(km|ak|wc)_[ms]_?/, '');
        if (data.servers[mVid]) {
          for (const srv of data.servers[mVid]) {
            if (!data.servers[canonicalVid].some(x => x.embed === srv.embed)) {
              data.servers[canonicalVid].push(srv);
            }
          }
        }
        data.servers[m.id] = data.servers[canonicalVid];
        data.servers[mVid] = data.servers[canonicalVid];
      }

      deduplicatedMovies.push(canonical);
    }
  }
  data.movies = deduplicatedMovies;
  console.log(`Deduplicated movies: merged ${moviesMergedCount} duplicate movie entries.`);

  // Clean subgenres: filter by surviving IDs
  const seriesIdSet = new Set(data.series.map(s => s.id));
  const subgenreArrays = ['turkish', 'egyptian', 'syrian', 'gulf', 'ramadan', 'foreign_series', 'dubbed_series'];
  for (const sg of subgenreArrays) {
    if (Array.isArray(data[sg])) {
      const seen = new Set();
      data[sg] = data[sg].filter(item => {
        if (!seriesIdSet.has(item.id)) return false;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    }
  }

  // ----------------------------------------------------
  // STEP 8: Final Metrics & Save
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log('  FINAL PURIFIED CATALOG METRICS');
  console.log('====================================================');
  console.log(`Total Movies: ${data.movies.length} (Legitimate standalone movies only)`);
  console.log(`Total Series: ${data.series.length} (Consolidated with full episodes)`);
  console.log(`Total Unified Series: ${Object.keys(data.unifiedSeries).length}`);
  console.log(`Total Verified Server Keys: ${Object.keys(data.servers).length}`);

  // Check episodes in movies
  const remainingEpisodesInMovies = data.movies.filter(m => epRegex.test(m.name) && !m.name.includes('مباراة') && !m.name.includes('وراء الكواليس'));
  console.log(`Remaining episodes in movies: ${remainingEpisodesInMovies.length} (Goal: 0)`);

  fs.writeFileSync(INITIAL_DATA_FILE, JSON.stringify(data), 'utf8');
  console.log('Successfully saved purified initial_data.json!');
}

if (require.main === module) {
  runPurifyAndConsolidate().catch(console.error);
}

module.exports = { runPurifyAndConsolidate };
