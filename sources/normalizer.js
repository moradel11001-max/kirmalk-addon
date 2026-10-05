/**
 * Arabic Title Normalizer & Matcher for Multi-Source Deduplication
 */

function normalizeArabicTitle(raw) {
  if (!raw) return '';
  let s = raw.toString().toLowerCase();

  // Strip leading prefixes
  s = s.replace(/^(فيلم|مسلسل|مسرحية|برنامج|كارتون|رسوم متحركة)\s+/i, '');

  // Strip years (1900-2099)
  s = s.replace(/\b(19\d\d|20\d\d)\b/g, ' ');

  // Strip season words
  s = s.replace(/الموسم\s*(الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)/gi, ' ');
  s = s.replace(/موسم\s*(\d+)/gi, ' ');
  s = s.replace(/\b(s\d+|season\s*\d+)\b/gi, ' ');

  // Strip episode words
  s = s.replace(/الحلقة\s*(\d+|[^\s]+)/gi, ' ');
  s = s.replace(/حلقة\s*(\d+|[^\s]+)/gi, ' ');
  s = s.replace(/\b(e\d+|ep\d+|episode\s*\d+)\b/gi, ' ');

  // Strip technical / release tags
  s = s.replace(/\b(hdcam|hd|web-dl|webdl|bluray|dvd|1080p|720p|480p|fhd|uhd|4k|x264|x265)\b/gi, ' ');
  s = s.replace(/(اون لاين|اونلاين|مترجم|مدبلج|مشاهدة|تحميل|كامل|كامله|نسخة اصلية|عالي الجودة|جودة عالية|للكبار فقط)/gi, ' ');

  // Strip Arabic diacritics (tashkeel & tanween)
  s = s.replace(/[\u064B-\u065F\u0670]/g, '');

  // Normalize common Arabic letters
  s = s.replace(/[إأآا]/g, 'ا');
  s = s.replace(/[ة]/g, 'ه');
  s = s.replace(/[ى]/g, 'ي');
  s = s.replace(/[ؤ]/g, 'و');
  s = s.replace(/[ئ]/g, 'ي');

  // Remove non-alphanumeric (keep Arabic letters, digits, and english)
  s = s.replace(/[^\u0621-\u064Aa-z0-9\s]/g, ' ');

  // Collapse spaces
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Returns a score between 0.0 and 1.0 indicating similarity between two titles.
 */
function titleSimilarity(titleA, titleB) {
  const normA = normalizeArabicTitle(titleA);
  const normB = normalizeArabicTitle(titleB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  // Check substring containment if long enough
  if (normA.length >= 4 && normB.length >= 4) {
    if (normA.includes(normB) || normB.includes(normA)) {
      const minLen = Math.min(normA.length, normB.length);
      const maxLen = Math.max(normA.length, normB.length);
      if (minLen / maxLen >= 0.7) return 0.9;
    }
  }

  // Token overlap (Jaccard)
  const tokensA = new Set(normA.split(' ').filter(w => w.length > 1));
  const tokensB = new Set(normB.split(' ').filter(w => w.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

module.exports = {
  normalizeArabicTitle,
  titleSimilarity
};
