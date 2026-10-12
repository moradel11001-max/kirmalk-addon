/**
 * Automated Catalog Update Pipeline
 * Coordinates incremental or deep scraping across Kirmalk, Akwam, and WeCima,
 * followed by full catalog purification, deduplication, and stream server verification.
 */

const { runMerger } = require('./merge_multi_sources');
const { runPurifyAndConsolidate } = require('./purify_and_consolidate');

async function main() {
  const isDeep = process.argv.includes('--deep') || process.env.DEEP_SYNC === 'true';

  console.log('====================================================');
  console.log('      AUTOMATED CATALOG SYNC & PURIFY PIPELINE      ');
  console.log(`      Mode: ${isDeep ? 'DEEP BULK ARCHIVE CRAWL' : 'INCREMENTAL DAILY SYNC'}`);
  console.log('====================================================');

  try {
    // 1. Run multi-source merger
    console.log('\n[Stage 1/2] Ingesting new movies and series...');
    await runMerger({
      deep: isDeep,
      kirmalkSeriesPages: isDeep ? 35 : 3,
      kirmalkMoviePages: isDeep ? 20 : 3,
      kirmalkGenrePages: isDeep ? 10 : 2,
      akwamSeriesPages: isDeep ? 30 : 3,
      akwamMoviePages: isDeep ? 30 : 3,
      wecimaPages: isDeep ? 6 : 2
    });

    // 2. Run catalog purification & series consolidation
    console.log('\n[Stage 2/2] Purifying catalog, consolidating series, and validating streams...');
    await runPurifyAndConsolidate();

    console.log('\n====================================================');
    console.log('✅ AUTO-UPDATE PIPELINE COMPLETED SUCCESSFULLY!');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Auto-update pipeline failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
