const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const d = require('../initial_data.json');

function cleanSeriesName(title) {
  return title
    .replace(/^مسلسل\s+/gi, '')
    .replace(/^مسلسل\s+/gi, '')
    .replace(/الحلقة\s*\d+.*$/gi, '')
    .replace(/حلقة\s*\d+.*$/gi, '')
    .replace(/الموسم\s*\d+.*$/gi, '')
    .replace(/الموسم\s*(الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر).*$/gi, '')
    .replace(/\b(HD|720p|1080p|FHD|مترجم|مدبلج|مدبلجة|مترجمة|كاملة|اون لاين|شاهد)\b/gi, '')
    .replace(/[\(\)\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const categories = ['series', 'turkish', 'egyptian', 'syrian', 'gulf', 'ramadan'];
const allCards = [];

for (const cat of categories) {
  for (const card of (d[cat] || [])) {
    allCards.push({ ...card, category: cat });
  }
}

const seriesMap = new Map();

for (const card of allCards) {
  const cleanName = cleanSeriesName(card.name);
  if (!seriesMap.has(cleanName)) {
    const vid = card.id.replace(/^km_[ms]_?/, '');
    seriesMap.set(cleanName, {
      cleanName,
      name: 'مسلسل ' + cleanName,
      vid,
      id: `km_s_${vid}`,
      poster: card.poster,
      categories: [card.category],
      cards: [card]
    });
  } else {
    const entry = seriesMap.get(cleanName);
    if (!entry.categories.includes(card.category)) {
      entry.categories.push(card.category);
    }
    entry.cards.push(card);
  }
}

console.log('Unique series count:', seriesMap.size);
console.log('Sample series:');
let count = 0;
for (const [name, s] of seriesMap.entries()) {
  if (count++ < 10) {
    console.log(`- ${s.name} (vid: ${s.vid}, categories: ${s.categories.join(', ')}, cards count: ${s.cards.length})`);
  }
}
