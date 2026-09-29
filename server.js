'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Optional local .env support for Windows development.
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
} catch {}

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const CONFIG_FILE = path.join(DATA_DIR, 'site-config.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_ASSETS_BUCKET || 'site-assets';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const sessions = new Map();

const DEFAULT_CONFIG = {
  shopOpen: true,
  eyebrow: 'Officiële merch · Friends since day one',
  brand: 'Baddies',
  description: 'Drinkjes. Dansjes. Chaos. Twee boys, één vibe. Ontdek onze merch en beleef de Baddies-world met ons mee.',
  aboutLead: 'Wij zijn The Baddies — twee boys die houden van elkaar, van chicks en van onze vrienden: the Pubbers, the Goats en nog zoveel meer mensen.',
  aboutBody: 'Zelf maken wij gewoon veel plezier en laten wij jullie mee genieten. Van spontane momenten tot avonden die je niet snel vergeet: dat is de Baddies-vibe.',
  teeName: 'The Baddies Tee', teePrice: 24.99,
  hoodieName: 'The Baddies Hoodie', hoodiePrice: 49.99,
  heroImage: '', shopImage: '', teeImage: '', hoodieImage: '', galleryPhotos: {},
  tiktokUrl: 'https://www.tiktok.com/@de.baddies86?_r=1&_t=ZG-9A8gvIDYEbo'
};

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) writeJson(CONFIG_FILE, DEFAULT_CONFIG);
  if (!fs.existsSync(ORDERS_FILE)) writeJson(ORDERS_FILE, []);
}
function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }

function supabaseHeaders(extra = {}) {
  return { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, ...extra };
}
async function supabaseRequest(endpoint, options = {}) {
  if (!useSupabase) throw new Error('Supabase is not configured.');
  const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...options,
    headers: supabaseHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) })
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
  if (!response.ok) throw Object.assign(new Error(data?.message || data?.error || data?.hint || 'Supabase request failed.'), { status: response.status });
  return data;
}

async function ensureSupabaseBucket() {
  if (!useSupabase) return;
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, public: true, allowedMimeTypes: ['image/*'], fileSizeLimit: 5242880 })
    });
  } catch {}
}

async function uploadImageDataUrl(dataUrl, slot) {
  if (!dataUrl || !String(dataUrl).startsWith('data:image/')) return dataUrl || '';
  if (!useSupabase) return dataUrl;
  const match = String(dataUrl).match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!match) throw Object.assign(new Error('Ongeldige afbeelding.'), { status: 400 });
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) throw Object.assign(new Error('Een afbeelding mag maximaal ongeveer 5 MB zijn.'), { status: 400 });
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const safeSlot = String(slot).replace(/[^a-zA-Z0-9_-]/g, '-');
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
  const objectPath = `site/${safeSlot}-${hash}.${ext}`;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': mime, 'x-upsert': 'true', 'cache-control': '31536000' }),
    body: buffer
  });
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(text || 'Afbeelding uploaden is mislukt.'), { status: 502 });
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${objectPath}`;
}

async function normalizeConfigImages(config) {
  if (!useSupabase) return config;
  const out = { ...config, galleryPhotos: { ...(config.galleryPhotos || {}) } };
  for (const key of ['heroImage','shopImage','teeImage','hoodieImage']) {
    if (out[key] && String(out[key]).startsWith('data:image/')) out[key] = await uploadImageDataUrl(out[key], key);
  }
  for (const [key, value] of Object.entries(out.galleryPhotos)) {
    if (value && String(value).startsWith('data:image/')) out.galleryPhotos[key] = await uploadImageDataUrl(value, key);
  }
  return out;
}

async function getConfig() {
  if (!useSupabase) return { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, {}) };
  const rows = await supabaseRequest('/rest/v1/site_settings?select=config&id=eq.1');
  return { ...DEFAULT_CONFIG, ...(rows?.[0]?.config || {}) };
}
async function saveConfig(config) {
  const clean = { ...DEFAULT_CONFIG, ...config, galleryPhotos: config.galleryPhotos || {} };
  if (!useSupabase) {
    writeJson(CONFIG_FILE, clean);
    return clean;
  }
  await supabaseRequest('/rest/v1/site_settings?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ id: 1, config: clean, updated_at: new Date().toISOString() }])
  });
  return clean;
}
async function getOrders() {
  if (!useSupabase) return readJson(ORDERS_FILE, []);
  const rows = await supabaseRequest('/rest/v1/orders?select=data&order=created_at.asc&limit=1000');
  return (rows || []).map(row => row.data).filter(Boolean);
}
async function saveOrders(orders) {
  if (!useSupabase) { writeJson(ORDERS_FILE, orders); return orders; }
  if (!orders.length) return orders;
  const rows = orders.map(order => ({ id: order.id, data: order, created_at: order.createdAt || new Date().toISOString(), updated_at: order.updatedAt || new Date().toISOString() }));
  await supabaseRequest('/rest/v1/orders?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  return orders;
}
async function updateOrderFromPayment(payment) {
  const orderId = payment?.metadata?.orderId;
  if (!orderId) return;
  const orders = await getOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  order.paymentStatus = payment.status || order.paymentStatus;
  order.updatedAt = new Date().toISOString();
  if (payment.status === 'paid') order.status = 'paid';
  else if (['failed', 'canceled', 'expired'].includes(payment.status)) order.status = payment.status;
  await saveOrders(orders);
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(x => x.trim()).filter(Boolean).map(x => { const i=x.indexOf('='); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))]; }));
}
function isAdmin(req) {
  const id = parseCookies(req.headers.cookie).baddies_session;
  const session = id && sessions.get(id);
  if (!session) return false;
  if (session.expires < Date.now()) { sessions.delete(id); return false; }
  return true;
}
function readRawBody(req, max = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > max) { reject(new Error('Request is te groot.')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function readBody(req, max = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = ''; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > max) { reject(new Error('Ongeldige gegevens: de aanvraag is te groot.')); req.destroy(); return; } data += chunk; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Ongeldige gegevens ontvangen.')); } });
    req.on('error', reject);
  });
}
function safeText(value, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function money(value) { return (Math.round(Number(value) * 100) / 100).toFixed(2); }
async function mollieRequest(endpoint, options = {}) {
  const key = process.env.MOLLIE_API_KEY;
  if (!key) throw Object.assign(new Error('Betalen is nog niet ingesteld. Een beheerder moet eerst de Mollie API-sleutel als geheime serverinstelling toevoegen.'), { status: 503 });
  const response = await fetch(`https://api.mollie.com/v2${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.detail || result.title || 'De betaalprovider kon de aanvraag niet verwerken.'), { status: 502 });
  return result;
}
function publicOrderStatus(order) {
  return { orderId: order.id, status: order.status === 'paid' ? 'paid' : ['failed','canceled','expired'].includes(order.status) ? 'failed' : 'pending' };
}
function staticFile(req, res, pathname) {
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return send(res, 400, 'Ongeldige URL'); }
  if (decoded === '/') decoded = '/index.html';
  const file = path.resolve(ROOT, `.${decoded}`);
  if (!file.startsWith(ROOT + path.sep) || file === CONFIG_FILE || file === ORDERS_FILE || decoded.split('/').some(p => p.startsWith('.'))) return send(res, 404, 'Niet gevonden');
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Niet gevonden');
    const ext = path.extname(file).toLowerCase();
    const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8', '.ico':'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin' });
    fs.createReadStream(file).pipe(res);
  });
}

if (!useSupabase) ensureData();
ensureSupabaseBucket().catch(() => {});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'the-baddies-website', paymentConfigured: Boolean(process.env.MOLLIE_API_KEY), persistentStorage: useSupabase ? 'supabase' : 'local-disk', persistentStorageConfigured: useSupabase });
    if (req.method === 'GET' && url.pathname === '/api/site-config') return send(res, 200, { config: await getConfig() });
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const body = await readBody(req, 50_000);
      const expected = process.env.ADMIN_PASSWORD;
      if (!expected) return send(res, 503, { error: 'Beheerwachtwoord is nog niet ingesteld op de server.' });
      const provided = safeText(body.password, 500);
      const a = Buffer.from(provided); const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { error: 'Onjuist wachtwoord.' });
      const id = crypto.randomBytes(32).toString('hex'); sessions.set(id, { expires: Date.now() + 8 * 60 * 60 * 1000 });
      return send(res, 200, { ok: true }, { 'Set-Cookie': `baddies_session=${id}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      const id = parseCookies(req.headers.cookie).baddies_session; if (id) sessions.delete(id);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'baddies_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' });
    }
    if (req.method === 'PUT' && url.pathname === '/api/admin/site-config') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Log eerst opnieuw in bij Website aanpassen.' });
      const body = await readBody(req);
      const incoming = body.config;
      if (!incoming || typeof incoming !== 'object') return send(res, 400, { error: 'Geen geldige website-instellingen ontvangen.' });
      const config = await getConfig();
      for (const key of ['shopOpen','eyebrow','brand','description','aboutLead','aboutBody','teeName','teePrice','hoodieName','hoodiePrice','heroImage','shopImage','teeImage','hoodieImage','galleryPhotos','tiktokUrl']) {
        if (Object.prototype.hasOwnProperty.call(incoming, key)) config[key] = incoming[key];
      }
      config.shopOpen = config.shopOpen !== false;
      for (const key of ['eyebrow','brand','description','aboutLead','aboutBody','teeName','hoodieName']) config[key] = safeText(config[key], 2000);
      for (const key of ['teePrice','hoodiePrice']) { config[key] = Number(config[key]); if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 10000) return send(res, 400, { error: 'Ongeldige productprijs.' }); }
      if (config.tiktokUrl && !(typeof config.tiktokUrl === 'string' && /^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._]+(?:[/?#][^\s]*)?$/.test(config.tiktokUrl))) return send(res, 400, { error: 'Vul een geldige TikTok-profiel-link in.' });
      for (const key of ['heroImage','shopImage','teeImage','hoodieImage']) if (config[key] && !(typeof config[key] === 'string' && (config[key].startsWith('data:image/') || /^https:\/\//.test(config[key])))) return send(res, 400, { error: 'Gebruik een geldig afbeeldingsbestand.' });
      if (!config.galleryPhotos || typeof config.galleryPhotos !== 'object') config.galleryPhotos = {};
      for (const [key, value] of Object.entries(config.galleryPhotos)) if (value && !(typeof value === 'string' && (value.startsWith('data:image/') || /^https:\/\//.test(value)))) return send(res, 400, { error: 'Een galerijfoto is ongeldig.' });
      const storedConfig = await normalizeConfigImages(config);
      const saved = await saveConfig(storedConfig);
      return send(res, 200, { ok: true, config: saved, persistentStorage: useSupabase ? 'supabase' : 'local-disk' });
    }
    if (req.method === 'POST' && url.pathname === '/api/create-payment') {
      const config = await getConfig();
      if (!config.shopOpen) return send(res, 403, { error: 'De shop is tijdelijk gesloten. Bestellen kan weer zodra we openen.' });
      if (!BASE_URL || !/^https:\/\//i.test(BASE_URL)) return send(res, 503, { error: 'De publieke HTTPS-website-URL (BASE_URL) is nog niet ingesteld.' });
      const body = await readBody(req, 100_000); const customer = body.customer || {}; const items = body.items;
      const name = safeText(customer.name, 120); const email = safeText(customer.email, 200); const street = safeText(customer.street, 250); const postalCode = safeText(customer.postalCode, 30); const city = safeText(customer.city, 120);
      if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !street || !postalCode || !city) return send(res, 400, { error: 'Vul alle contact- en adresgegevens correct in.' });
      if (!Array.isArray(items) || !items.length || items.length > 20) return send(res, 400, { error: 'Je winkelmandje is leeg of ongeldig.' });
      const catalog = { tee: { name: safeText(config.teeName, 120) || 'The Baddies Tee', price: Number(config.teePrice), sizes: ['XS','S','M','L','XL','XXL'] }, hoodie: { name: safeText(config.hoodieName, 120) || 'The Baddies Hoodie', price: Number(config.hoodiePrice), sizes: ['XS','S','M','L','XL','XXL'] } };
      const lines = []; let totalCents = 0;
      for (const item of items) {
        const product = catalog[item.productId]; const quantity = Number(item.quantity); const size = safeText(item.size, 8).toUpperCase();
        if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !product.sizes.includes(size) || !Number.isFinite(product.price) || product.price < 0) return send(res, 400, { error: 'Een product, maat, aantal of prijs is ongeldig.' });
        const cents = Math.round(product.price * 100); totalCents += cents * quantity;
        lines.push({ productId: item.productId, name: product.name, size, quantity, unitPrice: money(product.price), lineTotal: money(cents * quantity / 100) });
      }
      if (totalCents < 1 || totalCents > 10000000) return send(res, 400, { error: 'Het bestelbedrag is ongeldig.' });
      const orderId = crypto.randomUUID(); const now = new Date().toISOString();
      const order = { id: orderId, createdAt: now, updatedAt: now, status: 'pending', paymentStatus: 'open', currency: 'EUR', total: money(totalCents / 100), items: lines, customer: { name, email, street, postalCode, city } };
      const orders = await getOrders(); orders.push(order); await saveOrders(orders);
      try {
        const payment = await mollieRequest('/payments', { method: 'POST', body: JSON.stringify({ amount: { currency: 'EUR', value: money(totalCents / 100) }, description: `The Baddies bestelling ${orderId.slice(0, 8)}`, redirectUrl: `${BASE_URL}/?payment=return&order=${encodeURIComponent(orderId)}`, webhookUrl: `${BASE_URL}/api/mollie-webhook`, metadata: { orderId }, locale: 'nl_BE' }) });
        order.paymentId = payment.id; order.checkoutUrl = payment._links?.checkout?.href || ''; order.paymentStatus = payment.status || 'open';
        const refreshed = await getOrders(); const index = refreshed.findIndex(o => o.id === orderId); if (index >= 0) refreshed[index] = order; await saveOrders(refreshed);
        if (!order.checkoutUrl) throw new Error('De betaalprovider heeft geen betaalpagina teruggegeven.');
        return send(res, 200, { checkoutUrl: order.checkoutUrl, orderId });
      } catch (error) {
        const refreshed = await getOrders(); const found = refreshed.find(o => o.id === orderId); if (found) { found.status = 'payment_setup_failed'; found.updatedAt = new Date().toISOString(); await saveOrders(refreshed); }
        return send(res, error.status || 502, { error: error.message || 'Betaling aanmaken is mislukt.' });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/mollie-webhook') {
      const raw = await readRawBody(req, 20_000); let paymentId = '';
      if ((req.headers['content-type'] || '').includes('application/json')) { try { paymentId = safeText(JSON.parse(raw).id, 100); } catch {} }
      else paymentId = safeText(new URLSearchParams(raw).get('id'), 100);
      if (!paymentId) return send(res, 400, 'Missing payment id');
      const payment = await mollieRequest(`/payments/${encodeURIComponent(paymentId)}`); await updateOrderFromPayment(payment); return send(res, 200, 'OK');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/order-status/')) {
      const orderId = safeText(decodeURIComponent(url.pathname.slice('/api/order-status/'.length)), 100);
      const orders = await getOrders(); const order = orders.find(o => o.id === orderId);
      if (!order) return send(res, 404, { error: 'Bestelling niet gevonden.' });
      if (order.paymentId) { try { await updateOrderFromPayment(await mollieRequest(`/payments/${encodeURIComponent(order.paymentId)}`)); } catch {} }
      const latest = (await getOrders()).find(o => o.id === orderId) || order;
      return send(res, 200, publicOrderStatus(latest));
    }
    return staticFile(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return send(res, error.status || 500, { error: error.message || 'Er is iets misgegaan op de server.' });
  }
});
server.listen(PORT, () => console.log(`The Baddies draait op poort ${PORT}${useSupabase ? ' met Supabase-opslag' : ' met lokale opslag'}.`));
