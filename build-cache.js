const fs = require('fs');
const path = require('path');
const {
  scrapeMovies,
  scrapeSeries,
  scrapeCategory,
  scrapeSearch
} = require('./scraper');

async function build() {
  console.log('Building initial_data.json catalog snapshot...');
  const data = {};

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    console.log('Fetching movies page 1 & 2...');
    const m1 = await scrapeMovies(1);
    await delay(300);
    const m2 = await scrapeMovies(2);
    data['movies'] = [...m1, ...m2];
    console.log(`Movies: ${data['movies'].length}`);

    console.log('Fetching general series...');
    const s1 = await scrapeSeries(1);
    await delay(300);
    const s2 = await scrapeSeries(2);
    data['series'] = [...s1, ...s2];
    console.log(`General series: ${data['series'].length}`);

    console.log('Fetching Turkish series...');
    const t1 = await scrapeCategory('turk14', 1);
    await delay(300);
    const t2 = await scrapeCategory('turk14', 2);
    data['turkish'] = [...t1, ...t2];
    console.log(`Turkish series: ${data['turkish'].length}`);

    console.log('Fetching Egyptian series...');
    const eg1 = await scrapeCategory('serieseg4', 1);
    await delay(300);
    const eg2 = await scrapeCategory('serieseg4', 2);
    data['egyptian'] = [...eg1, ...eg2];
    console.log(`Egyptian series: ${data['egyptian'].length}`);

    console.log('Fetching Syrian series...');
    const sy1 = await scrapeCategory('seriessy5', 1);
    await delay(300);
    const sy2 = await scrapeCategory('seriessy5', 2);
    data['syrian'] = [...sy1, ...sy2];
    console.log(`Syrian series: ${data['syrian'].length}`);

    console.log('Fetching Gulf series...');
    const g1 = await scrapeCategory('series5l', 1);
    await delay(300);
    const g2 = await scrapeCategory('series5l', 2);
    data['gulf'] = [...g1, ...g2];
    console.log(`Gulf series: ${data['gulf'].length}`);

    console.log('Fetching Ramadan series...');
    const r1 = await scrapeCategory('rmadan27', 1);
    data['ramadan'] = r1;
    console.log(`Ramadan series: ${data['ramadan'].length}`);

    console.log('Fetching Plays...');
    const p1 = await scrapeSearch('مسرحية', 1);
    data['plays'] = p1;
    console.log(`Plays: ${data['plays'].length}`);

    const outFile = path.join(__dirname, 'initial_data.json');
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
    console.log(`\nSUCCESS: Saved ${Object.keys(data).length} categories to initial_data.json!`);
  } catch (err) {
    console.error('Error building cache:', err);
  }
}

build();
