export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL required' });

  let targetUrl = url.trim();
  if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

  try {
    new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ error: `Site returned ${response.status}` });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return res.status(400).json({ error: 'URL did not return HTML' });
    }

    const html = await response.text();

    // Also try fetching robots.txt and sitemap
    let robotsTxt = null;
    let sitemapFound = false;
    const baseUrl = new URL(targetUrl);
    const origin = baseUrl.origin;

    try {
      const rRes = await fetch(origin + '/robots.txt', {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'SiteScopeBot/1.0' },
      });
      if (rRes.ok) {
        const rText = await rRes.text();
        if (rText.includes('User-agent')) robotsTxt = rText.substring(0, 2000);
      }
    } catch {}

    try {
      const sRes = await fetch(origin + '/sitemap.xml', {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'SiteScopeBot/1.0' },
      });
      if (sRes.ok) {
        const sText = await sRes.text();
        sitemapFound = sText.includes('<url') || sText.includes('<sitemap');
      }
    } catch {}

    const isHttps = targetUrl.startsWith('https');

    return res.status(200).json({
      html,
      finalUrl: response.url || targetUrl,
      isHttps,
      robotsTxt,
      sitemapFound,
      statusCode: response.status,
      headers: {
        server: response.headers.get('server') || '',
        contentType: response.headers.get('content-type') || '',
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Site took too long to respond (15s timeout)' });
    }
    return res.status(502).json({ error: `Could not reach site: ${err.message}` });
  }
}
