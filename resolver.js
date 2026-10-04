const axios = require('axios');
const cheerio = require('cheerio');

const http = axios.create({
  headers: {
    'User-Agent': 'okhttp/4.9.3',
    'Referer': 'https://kirmalk.com/'
  },
  timeout: 5000,
  maxRedirects: 5
});

// ---------- Dean Edwards Packer Unpacker (p,a,c,k,e,d) ----------
function unpackDeanEdwards(packed) {
  if (!packed || typeof packed !== 'string') return packed;

  const pattern = /eval\(function\(p,a,c,k,e,[r|d]\)[\s\S]+?\}\s*\(\s*(['"][\s\S]+?['"])\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"][\s\S]+?['"])\.split\(['"]\|['"]\)/g;

  let result = packed;
  let match;

  while ((match = pattern.exec(packed)) !== null) {
    try {
      let payload = match[1];
      if ((payload.startsWith("'") && payload.endsWith("'")) || (payload.startsWith('"') && payload.endsWith('"'))) {
        payload = payload.slice(1, -1);
      }

      const radix = parseInt(match[2], 10);
      let symtabStr = match[4];
      if ((symtabStr.startsWith("'") && symtabStr.endsWith("'")) || (symtabStr.startsWith('"') && symtabStr.endsWith('"'))) {
        symtabStr = symtabStr.slice(1, -1);
      }
      const dict = symtabStr.split('|');

      const baseDecode = (str, rad) => {
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (rad <= 36) return parseInt(str, rad);
        let num = 0;
        for (let i = 0; i < str.length; i++) {
          const idx = chars.indexOf(str[i]);
          if (idx === -1 || idx >= rad) return NaN;
          num = num * rad + idx;
        }
        return num;
      };

      const unpackedCode = payload.replace(/\b\w+\b/g, (word) => {
        const idx = baseDecode(word, radix);
        if (!isNaN(idx) && dict[idx] !== undefined && dict[idx] !== '') {
          return dict[idx];
        }
        return word;
      });

      result = result.replace(match[0], unpackedCode);
    } catch (_) {}
  }

  return result;
}

// ---------- Generic media URL extractor ----------
function extractMediaUrls(html) {
  const urls = new Set();
  let source = html;

  if (/eval\(function\(p,a,c,k,e,[r|d]\)/.test(source)) {
    try {
      source = unpackDeanEdwards(source);
    } catch (_) {}
  }

  const patterns = [
    /file\s*:\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4|mkv)[^"']*)["']/gi,
    /src\s*=\s*["'](https?:\/\/[^"']+?\.(?:mp4|mkv|m3u8)[^"']*)["']/gi,
    /url\s*:\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4)[^"']*)["']/gi,
    /["'](https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4|mkv)[^"'\s<>]*)["']/gi,
    /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)\?[^\s"'<>]+)/gi
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(source)) !== null) {
      const url = match[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
      if (/\.(?:m3u8|mp4|mkv)/i.test(url)) {
        urls.add(url);
      }
    }
  }

  return [...urls];
}

// ---------- OK.ru resolver ----------
async function resolveOkRu(url) {
  try {
    const videoIdMatch = url.match(/(?:videoembed|video)\/(\d+)/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    const { data: html } = await http.get(url, {
      headers: { 'Referer': 'https://kirmalk.com/' }
    });

    const streams = [];

    const optionsMatch = html.match(/data-options\s*=\s*["'](\{[\s\S]+?\})["']/i) ||
                         html.match(/data-movie-options\s*=\s*["'](\{[\s\S]+?\})["']/i);

    let metadata = null;
    if (optionsMatch) {
      try {
        const decoded = optionsMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        metadata = JSON.parse(decoded);
      } catch (_) {}
    }

    if (!metadata && videoId) {
      try {
        const metaRes = await http.post(
          'https://www.ok.ru/dk?cmd=videoPlayerMetadata',
          `mid=${videoId}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': url
            }
          }
        );
        if (metaRes.data && (metaRes.data.videos || metaRes.data.hlsManifestUrl)) {
          metadata = metaRes.data;
        }
      } catch (_) {}
    }

    if (metadata) {
      if (metadata.hlsManifestUrl) {
        streams.push({
          title: 'OK.ru (HLS)',
          url: metadata.hlsManifestUrl,
          referer: 'https://www.ok.ru/'
        });
      }
      if (Array.isArray(metadata.videos)) {
        for (const v of metadata.videos) {
          if (v.url) {
            streams.push({
              title: `OK.ru (${(v.name || 'MP4').toUpperCase()})`,
              url: v.url,
              referer: 'https://www.ok.ru/'
            });
          }
        }
      }
    }

    if (streams.length === 0) {
      const genericUrls = extractMediaUrls(html);
      for (const u of genericUrls) {
        streams.push({ title: 'OK.ru Direct', url: u, referer: 'https://www.ok.ru/' });
      }
    }

    return streams;
  } catch (err) {
    return [];
  }
}

// ---------- DoodStream resolver ----------
async function resolveDood(url) {
  try {
    const { data: html } = await http.get(url, {
      headers: { 'Referer': 'https://kirmalk.com/' }
    });

    const passMatch = html.match(/\/pass_md5\/[a-zA-Z0-9\-_]+/);
    const tokenMatch = html.match(/token=([a-zA-Z0-9]+)/);
    if (!passMatch) return [];

    const parsedUrl = new URL(url);
    const passUrl = `${parsedUrl.origin}${passMatch[0]}`;
    const { data: prefix } = await http.get(passUrl, {
      headers: { 'Referer': url }
    });

    if (!prefix || typeof prefix !== 'string') return [];

    const randomStr = Math.random().toString(36).substring(2, 12);
    const token = tokenMatch ? tokenMatch[1] : '';
    const finalUrl = `${prefix}${randomStr}?token=${token}&expiry=${Date.now()}`;

    return [{ title: 'DoodStream (MP4)', url: finalUrl, referer: url }];
  } catch (err) {
    return [];
  }
}

// ---------- Google Drive resolver ----------
async function resolveGoogleDrive(url) {
  try {
    const idMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      const id = idMatch[1];
      return [{
        title: 'Google Drive Stream',
        url: `https://drive.google.com/uc?export=download&id=${id}`,
        referer: 'https://drive.google.com/'
      }];
    }
    return [];
  } catch (_) {
    return [];
  }
}

// ---------- Generic Web / StreamWish / VidHide / HDup resolver ----------
async function resolveGeneric(url, depth = 0) {
  if (depth > 2) return [];
  try {
    let embedOrigin = 'https://kirmalk.com/';
    try {
      embedOrigin = new URL(url).origin + '/';
    } catch (_) {}

    const { data: html } = await http.get(url, {
      headers: {
        'Referer': 'https://kirmalk.com/'
      }
    });

    const mediaUrls = extractMediaUrls(html);
    const streams = [];

    for (const mUrl of mediaUrls) {
      const isHls = /\.m3u8/i.test(mUrl);
      streams.push({
        title: isHls ? 'HLS (m3u8)' : 'MP4 Direct',
        url: mUrl,
        referer: embedOrigin
      });
    }

    if (streams.length === 0 && typeof html === 'string') {
      const $ = cheerio.load(html);
      const iframeSrc = $('iframe').attr('src');
      if (iframeSrc && /^https?:\/\//i.test(iframeSrc)) {
        return await resolveEmbed(iframeSrc, depth + 1);
      }
    }

    return streams;
  } catch (err) {
    return [];
  }
}

// ---------- Master Embed Resolver ----------
async function resolveEmbed(embedUrl, depth = 0) {
  if (!embedUrl || typeof embedUrl !== 'string') return [];

  let embedOrigin = 'https://kirmalk.com/';
  try {
    embedOrigin = new URL(embedUrl).origin + '/';
  } catch (_) {}

  if (/\.(?:m3u8|mp4|mkv)(?:\?.*)?$/i.test(embedUrl)) {
    return [{
      title: /\.m3u8/i.test(embedUrl) ? 'HLS Direct' : 'MP4 Direct',
      url: embedUrl,
      referer: embedOrigin
    }];
  }

  if (embedUrl.startsWith('//')) {
    embedUrl = 'https:' + embedUrl;
  }

  const lower = embedUrl.toLowerCase();

  if (lower.includes('ok.ru')) {
    return await resolveOkRu(embedUrl);
  } else if (lower.includes('dood.') || lower.includes('ds2play.') || lower.includes('d-stream.')) {
    return await resolveDood(embedUrl);
  } else if (lower.includes('drive.google.com')) {
    return await resolveGoogleDrive(embedUrl);
  } else {
    return await resolveGeneric(embedUrl, depth);
  }
}

module.exports = {
  resolveEmbed,
  extractMediaUrls,
  unpackDeanEdwards
};
