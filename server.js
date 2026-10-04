const express = require('express');
const os = require('os');
const axios = require('axios');
const { manifest, getCatalog, getMeta, getStreamsFor } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 7860;

// ---------- CORS & Private Network Middleware ----------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

function getHostUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

// ---------- Landing Page ----------
app.get('/', (req, res) => {
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const hostUrl = `${protocol}://${host}`;
  const manifestUrl = `${hostUrl}/manifest.json`;
  const stremioInstallUrl = `stremio://${host}/manifest.json`;

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="utf-8">
      <title>Kirmalk TV - Stremio Addon</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: #0f111a;
          color: #f1f1f1;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
        }
        .card {
          background: #1a1d2e;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          max-width: 500px;
          width: 100%;
          text-align: center;
          border: 1px solid #272b40;
        }
        h1 { margin-top: 0; color: #ff5722; font-size: 28px; }
        p { color: #a0a5b9; line-height: 1.6; font-size: 15px; }
        .btn {
          display: inline-block;
          background: #ff5722;
          color: #fff;
          padding: 14px 28px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: bold;
          font-size: 16px;
          margin-top: 20px;
          transition: background 0.2s;
        }
        .btn:hover { background: #e64a19; }
        .url-box {
          background: #111320;
          padding: 12px;
          border-radius: 8px;
          font-family: monospace;
          word-break: break-all;
          margin: 20px 0;
          direction: ltr;
          color: #4fc3f7;
          border: 1px dashed #30364f;
        }
        .tag {
          display: inline-block;
          background: #23283f;
          color: #82b1ff;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 12px;
          margin: 4px;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>كرمالك TV (Kirmalk)</h1>
        <p>إضافة ستريميو الرسمية لمشاهدة الأفلام والمسلسلات العربية والتركية من موقع كرمالك.</p>
        
        <div>
          <span class="tag">🎬 أفلام</span>
          <span class="tag">📺 مسلسلات</span>
          <span class="tag">🔍 بحث فوري</span>
          <span class="tag">⚡ Android TV ExoPlayer Ready</span>
        </div>

        <a class="btn" href="${stremioInstallUrl}">تثبيت على Stremio</a>

        <p style="margin-top: 25px; font-size: 13px;">أو انسخ رابط الـ Manifest التالي وألصقه في شريط بحث ستريميو:</p>
        <div class="url-box">${manifestUrl}</div>
      </div>
    </body>
    </html>
  `);
});

// ---------- Manifest Endpoint ----------
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// ---------- Catalog Endpoint ----------
app.get(/^\/catalog\/([^/]+)\/([^/]+?)(?:\.json|\/(.*))?$/, async (req, res) => {
  try {
    const type = req.params[0];
    const id = req.params[1].replace(/\.json$/, '');
    let rest = req.params[2] || '';
    rest = rest.replace(/\.json$/, '');

    const extra = {};
    if (rest) {
      const parts = rest.split(/[/&]/);
      for (const part of parts) {
        const [k, v] = part.split('=');
        if (k && v !== undefined) {
          try {
            extra[decodeURIComponent(k)] = decodeURIComponent(v);
          } catch (_) {
            extra[k] = v;
          }
        }
      }
    }
    if (req.query) {
      Object.assign(extra, req.query);
    }

    const hostUrl = getHostUrl(req);
    const result = await getCatalog(type, extra, hostUrl);
    res.json(result);
  } catch (e) {
    console.error('Catalog route error:', e.message);
    res.json({ metas: [] });
  }
});

// ---------- Meta Endpoint ----------
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const hostUrl = getHostUrl(req);
    const meta = await getMeta(type, id, hostUrl);
    res.json({ meta: meta || {} });
  } catch (e) {
    console.error('Meta route error:', e.message);
    res.json({ meta: {} });
  }
});

// ---------- Streams Endpoint ----------
const streamMemoryCache = {};

app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params;
    const hostUrl = getHostUrl(req);
    const cacheKey = `${id}_${hostUrl}`;

    if (streamMemoryCache[cacheKey] && streamMemoryCache[cacheKey].expires > Date.now()) {
      return res.json({ streams: streamMemoryCache[cacheKey].data });
    }

    const parts = id.split(':');
    const baseId = parts[0];
    const season = parts[1];
    const episode = parts[2];

    const streams = await getStreamsFor(id, season, episode, hostUrl);
    const result = streams || [];

    if (result.length > 0) {
      streamMemoryCache[cacheKey] = {
        data: result,
        expires: Date.now() + 600000 // 10 minutes cache
      };
    }

    res.json({ streams: result });
  } catch (e) {
    console.error('Stream route error:', e.message);
    res.json({ streams: [] });
  }
});

// ---------- Poster Image Proxy ----------
app.get('/proxy/image.jpg', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const response = await axios({
      method: 'get',
      url: imageUrl,
      headers: {
        'User-Agent': 'okhttp/4.9.3',
        'Referer': 'https://kirmalk.com/'
      },
      responseType: 'arraybuffer',
      timeout: 10000
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.send(response.data);
  } catch (err) {
    res.status(404).send('Image unavailable');
  }
});

// ---------- HLS & MP4 Stream Proxy Endpoints ----------
// Notice: /proxy/stream.m3u8 informs Android TV ExoPlayer to use HlsMediaSource!
app.get([
  '/proxy/stream.m3u8',
  '/proxy/sub.m3u8',
  '/proxy/segment.ts',
  '/proxy/video.mp4',
  '/proxy/hls'
], async (req, res) => {
  const targetUrl = req.query.url;
  const referer = req.query.referer || 'https://kirmalk.com/';

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const hostUrl = getHostUrl(req);

    const headers = {
      'User-Agent': 'okhttp/4.9.3',
      'Referer': referer
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await axios({
      method: 'get',
      url: targetUrl,
      headers,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      timeout: 25000
    });

    res.status(response.status);

    for (const [k, v] of Object.entries(response.headers)) {
      if (['content-length', 'content-range', 'accept-ranges'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    // Handle MP4 Progressive Playback
    const contentType = (response.headers['content-type'] || '').toLowerCase();
    if (req.path.includes('.mp4') || targetUrl.includes('.mp4') || contentType.includes('video/mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      return res.send(response.data);
    }

    // Check if body is an M3U8 Playlist
    let isPlaylist = false;
    let text = '';
    if (response.status === 200 && response.data && response.data.length > 0) {
      const headerSnippet = response.data.slice(0, 30).toString('utf8');
      if (headerSnippet.includes('#EXTM3U') || targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || req.path.includes('.m3u8')) {
        isPlaylist = true;
        text = Buffer.from(response.data).toString('utf8');
      }
    }

    if (isPlaylist) {
      const lines = text.split('\n');
      let isNextSub = false;

      const rewritten = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith('#')) {
          if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
            isNextSub = true;
          }
          if (trimmed.includes('URI="')) {
            return line.replace(/URI="([^"]+)"/, (m, uri) => {
              const fullKeyUrl = uri.startsWith('http') ? uri : new URL(uri, targetUrl).toString();
              return `URI="${hostUrl}/proxy/segment.ts?url=${encodeURIComponent(fullKeyUrl)}&referer=${encodeURIComponent(referer)}"`;
            });
          }
          return line;
        }

        let fullChunkUrl = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          fullChunkUrl = new URL(trimmed, targetUrl).toString();
        }

        const isSub = isNextSub || fullChunkUrl.includes('.m3u8');
        isNextSub = false;
        const proxyPath = isSub ? '/proxy/sub.m3u8' : '/proxy/segment.ts';

        return `${hostUrl}${proxyPath}?url=${encodeURIComponent(fullChunkUrl)}&referer=${encodeURIComponent(referer)}`;
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // Set video/mp2t for TS segments
    if (targetUrl.includes('.ts') || req.path.includes('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
    } else if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }

    return res.send(response.data);
  } catch (err) {
    console.error('Stream Proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).send('Stream proxy error');
    }
  }
});

// ---------- Helper to find local LAN IP ----------
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ---------- Export app & Start Server ----------
module.exports = app;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log('\n======================================================');
    console.log('✅ Kirmalk Stremio Addon is running!');
    console.log(`📡 Local URL:   http://localhost:${PORT}/manifest.json`);
    console.log(`📺 TV / LAN URL: http://${localIp}:${PORT}/manifest.json`);
    console.log('======================================================\n');
  });
}
