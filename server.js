const express = require('express');
const os = require('os');
const https = require('https');
const axios = require('axios');
const { manifest, getManifest, ALL_CATALOGS, getCatalog, getMeta, getStreamsFor } = require('./scraper');

const agent = new https.Agent({ rejectUnauthorized: false });

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

// ---------- Config Parser Helper ----------
function parseConfig(rawConfig) {
  if (!rawConfig) return null;
  try {
    // 1. URL-safe Base64 or standard Base64
    const normalized = rawConfig.replace(/-/g, '+').replace(/_/g, '/');
    const buff = Buffer.from(normalized, 'base64');
    const str = buff.toString('utf8');
    if (str.startsWith('{') && str.endsWith('}')) {
      return JSON.parse(str);
    }
  } catch (_) {}

  try {
    // 2. URI-encoded JSON fallback
    const decoded = decodeURIComponent(rawConfig);
    if (decoded.startsWith('{') && decoded.endsWith('}')) {
      return JSON.parse(decoded);
    }
  } catch (_) {}

  return null;
}

// ---------- Modern Interactive Configuration / Landing Page ----------
function renderConfigPage(req, preConfig = null) {
  const host = req.get('host');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const hostUrl = `${protocol}://${host}`;

  // Default values or pre-populated from URL
  const selectedCatalogs = preConfig && Array.isArray(preConfig.catalogs)
    ? preConfig.catalogs
    : ['kirmalk_latest_series', 'kirmalk_latest_movies', 'kirmalk_ramadan', 'kirmalk_turkish', 'kirmalk_arabic_movies'];

  const quality = preConfig && preConfig.quality ? preConfig.quality : 'all';

  const initialConfig = {
    catalogs: selectedCatalogs,
    quality: quality
  };

  const initialB64 = Buffer.from(JSON.stringify(initialConfig))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const stremioInstallUrl = `stremio://${host}/config/${initialB64}/manifest.json`;
  const manifestUrl = `${hostUrl}/config/${initialB64}/manifest.json`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>كرمالك TV - إعدادات وتثبيت الإضافة</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="https://stremio.com/favicon.ico">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #0b0e14;
      color: #e6edf3;
      margin: 0;
      padding: 24px 16px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
    }
    .container {
      max-width: 680px;
      width: 100%;
      background: #151b23;
      border: 1px solid #28303e;
      border-radius: 18px;
      padding: 32px 28px;
      box-shadow: 0 15px 35px rgba(0,0,0,0.6);
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
    }
    .header h1 {
      margin: 0 0 10px;
      font-size: 27px;
      color: #ff5722;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .header p {
      margin: 0 0 16px;
      color: #8b949e;
      font-size: 15px;
      line-height: 1.6;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .badge {
      background: #1f2735;
      color: #58a6ff;
      border: 1px solid #303e54;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
    }
    .sources-box {
      background: #121820;
      border: 1px solid #242e3d;
      border-radius: 12px;
      padding: 14px 18px;
      margin-bottom: 22px;
    }
    .sources-title {
      font-weight: bold;
      font-size: 14px;
      color: #3fb950;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sources-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 6px;
    }
    .source-pill {
      background: #192230;
      color: #7ee787;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid #233526;
    }
    .section-card {
      background: #12161f;
      border: 1px solid #262e3d;
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 16px;
      font-weight: bold;
      color: #f0f6fc;
      margin-top: 0;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .checkbox-group, .radio-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .option-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: #171d27;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #242c3b;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .option-item:hover {
      border-color: #ff5722;
      background: #1c2330;
    }
    .option-item input {
      margin-top: 3px;
      cursor: pointer;
      accent-color: #ff5722;
      width: 18px;
      height: 18px;
    }
    .option-label {
      cursor: pointer;
      flex: 1;
    }
    .option-name {
      font-size: 14px;
      font-weight: 600;
      color: #e6edf3;
      display: block;
      margin-bottom: 2px;
    }
    .option-desc {
      font-size: 12px;
      color: #8b949e;
      line-height: 1.4;
      display: block;
    }
    .note-box {
      background: #101c2a;
      border: 1px solid #1f3b58;
      border-radius: 10px;
      padding: 14px;
      margin-top: 14px;
      color: #a5d6ff;
      font-size: 13px;
      line-height: 1.6;
    }
    .note-header {
      font-weight: bold;
      margin-bottom: 6px;
      color: #79c0ff;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
    }
    .install-section {
      text-align: center;
      margin-top: 26px;
      padding-top: 20px;
      border-top: 1px solid #242c3b;
    }
    .btn-install {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: linear-gradient(135deg, #ff5722 0%, #e64a19 100%);
      color: #ffffff;
      padding: 16px 36px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: bold;
      font-size: 18px;
      box-shadow: 0 4px 18px rgba(255, 87, 34, 0.4);
      transition: transform 0.15s, box-shadow 0.15s;
      width: 100%;
    }
    .btn-install:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 22px rgba(255, 87, 34, 0.6);
    }
    .copy-container {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }
    .url-input {
      flex: 1;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 10px 14px;
      color: #58a6ff;
      font-family: monospace;
      font-size: 12px;
      direction: ltr;
      outline: none;
    }
    .btn-copy {
      background: #21262d;
      border: 1px solid #30363d;
      color: #e6edf3;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
    }
    .btn-copy:hover {
      background: #30363d;
    }
    .tv-guide {
      margin-top: 20px;
      padding: 14px;
      background: #141720;
      border: 1px dashed #28303e;
      border-radius: 10px;
      text-align: right;
      font-size: 13px;
      color: #8b949e;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎬 كرمالك TV</h1>
      <p>الإضافة العربية المتكاملة لمشاهدة الأفلام والمسلسلات في تطبيق Stremio مع سيرفرات متعددة عالية السرعة.</p>
      <div class="badges">
        <span class="badge">🚀 الإصدار v1.2.0</span>
        <span class="badge">📺 4,800+ فيلم ومسلسل جاهز</span>
        <span class="badge">🔄 تحديث يومي ذكي</span>
        <span class="badge">⚡ سيرفرات احتياطية</span>
      </div>
    </div>

    <!-- Automatic Sources Info (No manual toggle as requested) -->
    <div class="sources-box">
      <div class="sources-title">⚡ مصادر البث المتصلة تلقائياً:</div>
      <div class="sources-pills">
        <span class="source-pill">🟢 كرمالك TV (سيرفرات فائقة السرعة)</span>
        <span class="source-pill">🟢 أكوام Akwam (سيرفرات بديلة FHD)</span>
        <span class="source-pill">🟢 وي سيما WeCima (سيرفرات احتياطية)</span>
      </div>
      <div style="font-size: 12px; color: #8b949e; line-height: 1.5; margin-top: 4px;">
        تعمل كافة المصادر معاً بنظام التبديل التلقائي الذكي لضمان استمرار البث وتوفر روابط تشغيل بديلة لأي عمل في أي وقت.
      </div>
    </div>

    <!-- Section 1: Home Page Catalogs -->
    <div class="section-card">
      <div class="section-title">📺 أقسام الصفحة الرئيسية في Stremio</div>
      <div style="font-size: 13px; color: #8b949e; margin-bottom: 14px;">
        اختر الأشرطة الأفقية التي تفضل ظهورها مباشرة على الشاشة الرئيسية (Home / Board) لتسهيل الوصول للأحدث:
      </div>
      <div class="checkbox-group">
        <label class="option-item">
          <input type="checkbox" name="catalog" value="kirmalk_latest_series" ${selectedCatalogs.includes('kirmalk_latest_series') ? 'checked' : ''} onchange="updateUrls()">
          <div class="option-label">
            <span class="option-name">🌟 أحدث المسلسلات (Latest Series)</span>
            <span class="option-desc">أحدث حلقات ومواسم المسلسلات الحالية مرتبة زمنياً بالأحدث أولاً.</span>
          </div>
        </label>

        <label class="option-item">
          <input type="checkbox" name="catalog" value="kirmalk_latest_movies" ${selectedCatalogs.includes('kirmalk_latest_movies') ? 'checked' : ''} onchange="updateUrls()">
          <div class="option-label">
            <span class="option-name">🎬 أحدث الأفلام (Latest Movies)</span>
            <span class="option-desc">أحدث إصدارات السينما العربية والأجنبية لعام 2026 و 2025 في الصدارة.</span>
          </div>
        </label>

        <label class="option-item">
          <input type="checkbox" name="catalog" value="kirmalk_ramadan" ${selectedCatalogs.includes('kirmalk_ramadan') ? 'checked' : ''} onchange="updateUrls()">
          <div class="option-label">
            <span class="option-name">🌙 مسلسلات رمضان (Ramadan Series)</span>
            <span class="option-desc">مكتبة الأعمال الرمضانية الكاملة مع جميع الحلقات المنظمة.</span>
          </div>
        </label>

        <label class="option-item">
          <input type="checkbox" name="catalog" value="kirmalk_turkish" ${selectedCatalogs.includes('kirmalk_turkish') ? 'checked' : ''} onchange="updateUrls()">
          <div class="option-label">
            <span class="option-name">🇹🇷 مسلسلات تركية (Turkish Series)</span>
            <span class="option-desc">أشهر وأحدث المسلسلات التركية المدبلجة والمترجمة.</span>
          </div>
        </label>

        <label class="option-item">
          <input type="checkbox" name="catalog" value="kirmalk_arabic_movies" ${selectedCatalogs.includes('kirmalk_arabic_movies') ? 'checked' : ''} onchange="updateUrls()">
          <div class="option-label">
            <span class="option-name">🇪🇬 أفلام عربي (Arabic Movies)</span>
            <span class="option-desc">أرشيف السينما المصرية والعربية من الكلاسيكيات إلى أحدث أفلام دور العرض.</span>
          </div>
        </label>
      </div>

      <div style="font-size: 12px; color: #6e7681; margin-top: 12px; line-height: 1.4;">
        📌 <b>ملاحظة:</b> قسم "كل المسلسلات" و"كل الأفلام" والبحث الشامل متاحون دائماً داخل تبويب الاستكشاف (Discover).
      </div>
    </div>

    <!-- Section 2: Streaming Quality -->
    <div class="section-card">
      <div class="section-title">⚡ جودة وسرعة البث</div>
      <div class="radio-group">
        <label class="option-item">
          <input type="radio" name="quality" value="all" ${quality === 'all' ? 'checked' : ''} onchange="updateUrls()">
          <div class="option-label">
            <span class="option-name">🚀 جميع الجودات الأصلية (FHD 1080p / 720p / 480p)</span>
            <span class="option-desc">الخيار الافتراضي: أعلى دقة فيديو ممكنة مع حرية اختيار السيرفر والجودة المفضلة.</span>
          </div>
        </label>

        <label class="option-item">
          <input type="radio" name="quality" value="saver" ${quality === 'saver' ? 'checked' : ''} onchange="updateUrls()">
          <div class="option-label">
            <span class="option-name">📉 وضع موفّر البيانات والإنترنت الضعيف (تقديم 720p و 480p)</span>
            <span class="option-desc">تقديم الجودات الخفيفة في المقدمة لتشغيل سريع ومباشر وتوفير استهلاك باقة الإنترنت.</span>
          </div>
        </label>
      </div>
    </div>

    <!-- TV Compatibility Info (Auto-enabled permanently) -->
    <div class="note-box" style="margin-top: 0; margin-bottom: 20px;">
      <div class="note-header">📺 دعم مشغل ExoPlayer وشاشات التلفزيون (Android TV)</div>
      <p style="margin: 0 0 6px;">
        تم تهيئة وتجهيز الإضافة لتعمل تلقائياً وبأقصى سرعة عبر مشغل <b>ExoPlayer</b> الرسمي المدمج داخل <b>Stremio</b> لشاشات التلفزيون وهواتف الأندرويد (بروابط مباشرة عالية الكفاءة ودعم التوجيه الذكي) دون الحاجة لمشغلات خارجية.
      </p>
    </div>

    <!-- Installation Actions -->
    <div class="install-section">
      <a id="installBtn" class="btn-install" href="${stremioInstallUrl}">🚀 تثبيت الإضافة في Stremio</a>

      <div style="margin-top: 18px; font-size: 13px; color: #8b949e;">
        أو يمكنك نسخ رابط الـ Manifest ولصقه في شريط بحث تطبيق Stremio:
      </div>

      <div class="copy-container">
        <input type="text" id="manifestInput" class="url-input" readonly value="${manifestUrl}">
        <button id="copyBtn" class="btn-copy" onclick="copyManifestUrl()">📋 نسخ الرابط</button>
      </div>

      <div class="tv-guide">
        💡 <b>نصيحة للتثبيت على التلفزيون (Android TV):</b><br>
        أسهل طريقة هي الضغط على زر <b>"تثبيت الإضافة في Stremio"</b> من هاتفك أو الكمبيوتر المسجّل <u>بنفس حسابك</u> في ستريميو، وستظهر الإضافة ومسلسلاتها تلقائياً على شاشة التلفزيون الخاص بك فوراً!
      </div>
    </div>
  </div>

  <script>
    function updateUrls() {
      const selectedCatalogs = [];
      document.querySelectorAll('input[name="catalog"]:checked').forEach(cb => {
        selectedCatalogs.push(cb.value);
      });

      const qualityEl = document.querySelector('input[name="quality"]:checked');
      const quality = qualityEl ? qualityEl.value : 'all';

      const configObj = {
        catalogs: selectedCatalogs,
        quality: quality
      };

      const jsonStr = JSON.stringify(configObj);
      const b64 = btoa(unescape(encodeURIComponent(jsonStr)))
        .replace(/\\+/g, '-')
        .replace(/\\//g, '_')
        .replace(/=+$/, '');

      const host = window.location.host;
      const protocol = window.location.protocol;
      const stremioUrl = 'stremio://' + host + '/config/' + b64 + '/manifest.json';
      const httpUrl = protocol + '//' + host + '/config/' + b64 + '/manifest.json';

      document.getElementById('installBtn').href = stremioUrl;
      document.getElementById('manifestInput').value = httpUrl;
    }

    function copyManifestUrl() {
      const input = document.getElementById('manifestInput');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        const btn = document.getElementById('copyBtn');
        const oldText = btn.innerHTML;
        btn.innerHTML = '✅ تم النسخ بنجاح!';
        setTimeout(() => { btn.innerHTML = oldText; }, 2500);
      });
    }
  </script>
</body>
</html>`;
}

// ---------- Landing & Configuration Routes ----------
app.get(['/', '/configure', '/config/:config/configure', '/:config/configure'], (req, res) => {
  const preConfig = parseConfig(req.params.config);
  res.send(renderConfigPage(req, preConfig));
});

// ---------- Manifest Endpoints (Default & Configured) ----------
app.get('/manifest.json', (req, res) => {
  res.json(getManifest(null));
});

app.get('/config/:config/manifest.json', (req, res) => {
  const config = parseConfig(req.params.config);
  res.json(getManifest(config));
});

app.get('/:config/manifest.json', (req, res) => {
  const config = parseConfig(req.params.config);
  res.json(getManifest(config));
});

// ---------- Catalog Route Handler ----------
async function handleCatalogRequest(req, res, userConfig, type, rawId, restParams) {
  try {
    const id = (rawId || '').replace(/\.json$/, '');
    let rest = restParams || '';
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
    const result = await getCatalog(type, id, extra, hostUrl);
    res.json(result);
  } catch (e) {
    console.error('Catalog route error:', e.message);
    res.json({ metas: [] });
  }
}

// 1. Unconfigured Catalog
app.get(/^\/catalog\/([^/]+)\/([^/]+?)(?:\.json|\/(.*))?$/, (req, res) => {
  return handleCatalogRequest(req, res, null, req.params[0], req.params[1], req.params[2]);
});

// 2. Configured Catalog with /config/:config/catalog/...
app.get(/^\/config\/([^/]+)\/catalog\/([^/]+)\/([^/]+?)(?:\.json|\/(.*))?$/, (req, res) => {
  const config = parseConfig(req.params[0]);
  return handleCatalogRequest(req, res, config, req.params[1], req.params[2], req.params[3]);
});

// 3. Configured Catalog with /:config/catalog/...
app.get(/^\/([^/]+)\/catalog\/([^/]+)\/([^/]+?)(?:\.json|\/(.*))?$/, (req, res, next) => {
  if (['config', 'proxy', 'catalog', 'meta', 'stream'].includes(req.params[0])) {
    return next();
  }
  const config = parseConfig(req.params[0]);
  return handleCatalogRequest(req, res, config, req.params[1], req.params[2], req.params[3]);
});

// ---------- Meta Route Handler ----------
async function handleMetaRequest(req, res, userConfig, type, rawId) {
  try {
    const id = (rawId || '').replace(/\.json$/, '');
    const hostUrl = getHostUrl(req);
    const meta = await getMeta(type, id, hostUrl);
    res.json({ meta: meta || {} });
  } catch (e) {
    console.error('Meta route error:', e.message);
    res.json({ meta: {} });
  }
}

app.get('/meta/:type/:id.json', (req, res) => {
  handleMetaRequest(req, res, null, req.params.type, req.params.id);
});

app.get('/config/:config/meta/:type/:id.json', (req, res) => {
  const config = parseConfig(req.params.config);
  handleMetaRequest(req, res, config, req.params.type, req.params.id);
});

app.get('/:config/meta/:type/:id.json', (req, res, next) => {
  if (['config', 'proxy', 'catalog', 'meta', 'stream'].includes(req.params.config)) return next();
  const config = parseConfig(req.params.config);
  handleMetaRequest(req, res, config, req.params.type, req.params.id);
});

// ---------- Streams Route Handler ----------
const streamMemoryCache = {};

async function handleStreamRequest(req, res, userConfig, type, rawId) {
  try {
    const id = (rawId || '').replace(/\.json$/, '');
    const hostUrl = getHostUrl(req);
    const cacheKey = `${id}_${hostUrl}_${userConfig ? (userConfig.quality || '') : 'default'}`;

    if (streamMemoryCache[cacheKey] && streamMemoryCache[cacheKey].expires > Date.now()) {
      return res.json({ streams: streamMemoryCache[cacheKey].data });
    }

    const parts = id.split(':');
    const baseId = parts[0];
    const season = parts[1];
    const episode = parts[2];

    const streams = await getStreamsFor(id, season, episode, hostUrl, userConfig);
    const result = streams || [];

    if (result.length > 0) {
      streamMemoryCache[cacheKey] = {
        data: result,
        expires: Date.now() + 600000 // 10 minutes cache
      };
    }

    res.json({ streams: result, ...(req.query.debug ? { debug: { id, hostUrl, count: result.length } } : {}) });
  } catch (e) {
    console.error('Stream route error:', e.message);
    res.json({ streams: [], error: e.message, stack: e.stack });
  }
}

app.get('/debug-stream/:id', async (req, res) => {
  try {
    const id = (req.params.id || '').replace(/\.json$/, '');
    const parts = id.split(':');
    const season = parts[1];
    const episode = parts[2];
    const hostUrl = getHostUrl(req);
    const resolver = require('./resolver');
    const scraper = require('./scraper');

    const cleanBase = parts[0].replace(/^(km|ak|wc)_[ms]_?/, '').replace(/^(km|ak|wc)_/, '');
    const s = initialData.unifiedSeries?.[parts[0]] || initialData.unifiedSeries?.[cleanBase];
    const ep = s?.videos?.find(v => v.episode === parseInt(episode, 10));
    
    let scrapedServers = [];
    if (ep && ep.vid) {
      const scr = await scraper.scrapeWatchServers(ep.vid);
      scrapedServers = scr.servers || [];
    }

    const resolutionDetails = [];
    for (const srv of scrapedServers) {
      try {
        const resolved = await resolver.resolveEmbed(srv.embed);
        resolutionDetails.push({ embed: srv.embed, resolvedCount: resolved.length, resolved });
      } catch (err) {
        resolutionDetails.push({ embed: srv.embed, error: err.message });
      }
    }

    const streams = await getStreamsFor(id, season, episode, hostUrl);
    res.json({ id, season, episode, foundSeries: !!s, foundEp: !!ep, epVid: ep?.vid, scrapedServers, resolutionDetails, streamsCount: streams ? streams.length : 0, streams });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.get('/stream/:type/:id.json', (req, res) => {
  handleStreamRequest(req, res, null, req.params.type, req.params.id);
});

app.get('/config/:config/stream/:type/:id.json', (req, res) => {
  const config = parseConfig(req.params.config);
  handleStreamRequest(req, res, config, req.params.type, req.params.id);
});

app.get('/:config/stream/:type/:id.json', (req, res, next) => {
  if (['config', 'proxy', 'catalog', 'meta', 'stream'].includes(req.params.config)) return next();
  const config = parseConfig(req.params.config);
  handleStreamRequest(req, res, config, req.params.type, req.params.id);
});

// ---------- Poster Image Proxy ----------
app.get('/proxy/image.jpg', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }

  let referer = 'https://kirmalk.com/';
  try {
    referer = new URL(imageUrl).origin + '/';
  } catch (_) {}

  try {
    const response = await axios({
      method: 'get',
      url: imageUrl,
      headers: {
        'User-Agent': 'okhttp/4.9.3',
        'Referer': referer
      },
      httpsAgent: agent,
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

// ---------- AES Key Proxy Endpoint (Fixes ExoPlayer Decryption Errors) ----------
app.get('/proxy/key', async (req, res) => {
  const targetUrl = req.query.url;
  const referer = req.query.referer || 'https://kirmalk.com/';

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const response = await axios({
      method: 'get',
      url: targetUrl,
      headers: {
        'User-Agent': 'okhttp/4.9.3',
        'Referer': referer
      },
      httpsAgent: agent,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      timeout: 10000
    });

    res.status(response.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(response.data);
  } catch (err) {
    console.error('Key Proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).send('Key proxy error');
    }
  }
});

// ---------- HLS & MP4 Stream Proxy Endpoints ----------
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

    const isM3U8Route = req.path.includes('.m3u8') || targetUrl.includes('.m3u8');

    // 1. MP4 Video Stream: forward Range requests with Referer to support ExoPlayer seek & resume
    if (req.path.includes('.mp4') || targetUrl.includes('.mp4')) {
      try {
        const streamHeaders = {
          'User-Agent': 'okhttp/4.9.3',
          'Referer': referer
        };
        if (req.headers.range) {
          streamHeaders['Range'] = req.headers.range;
        }

        const response = await axios({
          method: 'get',
          url: targetUrl,
          headers: streamHeaders,
          httpsAgent: agent,
          responseType: 'stream',
          validateStatus: () => true,
          timeout: 25000
        });

        res.status(response.status);
        for (const [k, v] of Object.entries(response.headers)) {
          if (['content-length', 'content-range', 'accept-ranges', 'content-type'].includes(k.toLowerCase())) {
            res.setHeader(k, v);
          }
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Content-Type', 'video/mp4');

        return response.data.pipe(res);
      } catch (err) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        return res.redirect(targetUrl);
      }
    }

    // 2. Binary TS chunk streaming
    if (!isM3U8Route) {
      const response = await axios({
        method: 'get',
        url: targetUrl,
        headers,
        httpsAgent: agent,
        responseType: 'stream',
        validateStatus: () => true,
        timeout: 25000
      });

      res.status(response.status);

      for (const [k, v] of Object.entries(response.headers)) {
        if (['content-length', 'content-range', 'accept-ranges', 'content-type'].includes(k.toLowerCase())) {
          res.setHeader(k, v);
        }
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Cache-Control', 'public, max-age=86400');

      if (req.path.includes('.ts') || targetUrl.includes('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
      }

      return response.data.pipe(res);
    }

    // 3. Playlist parsing and link rewriting (M3U8)
    const response = await axios({
      method: 'get',
      url: targetUrl,
      headers,
      httpsAgent: agent,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      timeout: 12000
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

    const text = Buffer.from(response.data).toString('utf8');
    const lines = text.split('\n');
    let isNextSub = false;

    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
          isNextSub = true;
        }

        // Dedicated AES Key rewriting to /proxy/key
        if (trimmed.includes('#EXT-X-KEY') && trimmed.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/, (m, uri) => {
            const fullKeyUrl = uri.startsWith('http') ? uri : new URL(uri, targetUrl).toString();
            return `URI="${hostUrl}/proxy/key?url=${encodeURIComponent(fullKeyUrl)}&referer=${encodeURIComponent(referer)}"`;
          });
        }

        // Media (Audio / Subtitles) rewriting to /proxy/sub.m3u8
        if (trimmed.includes('#EXT-X-MEDIA') && trimmed.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/, (m, uri) => {
            const fullMediaUrl = uri.startsWith('http') ? uri : new URL(uri, targetUrl).toString();
            return `URI="${hostUrl}/proxy/sub.m3u8?url=${encodeURIComponent(fullMediaUrl)}&referer=${encodeURIComponent(referer)}"`;
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
