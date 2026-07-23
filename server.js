/**
 * Backend de reservas de entrevistas
 * ------------------------------------------------------------
 * - Sirve la web de reservas (public/index.html)
 * - API pública para reservar sin login
 * - API de administración protegida con un token simple
 * - Feed ICS EN VIVO en /feed/:token.ics para suscribir en
 *   Apple Calendar (y de ahí importarlo a Structured)
 *
 * Guarda todo en un archivo JSON (data/db.json). Para un uso
 * chico/mediano (una empresa agendando entrevistas) alcanza de
 * sobra. Si en el futuro necesitás más escala o varios admins,
 * migrá esto a una base de datos real (Postgres, etc).
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '6mb' })); // suficiente para los logos en base64

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cambia-este-token';
const PORT = process.env.PORT || 3000;

// ---------- Utilidades de "base de datos" (archivo JSON) ----------

function uid() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

function defaultDb() {
  const days = () => ({
    sun: { enabled: false, ranges: [] },
    mon: { enabled: true, ranges: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
    tue: { enabled: true, ranges: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
    wed: { enabled: true, ranges: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
    thu: { enabled: true, ranges: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] },
    fri: { enabled: true, ranges: [{ start: '09:00', end: '14:00' }] },
    sat: { enabled: false, ranges: [] },
  });
  return {
    branding: { logo1: null, logo2: null },
    messages: {
      intro: 'Gracias por tu interés en sumarte al equipo.\nElegí el puesto al que te postulás y después una fecha y horario disponible para tu entrevista.',
      confirmation: 'Tu entrevista para el puesto de {puesto} quedó confirmada para el {fecha} a las {hora}.\nTe esperamos con puntualidad. ¡Gracias por postularte!'
    },
    positions: [
      { id: uid(), name: 'Puesto general', duration: 30, gap: 10, days: days(), specificDates: [] }
    ],
    bookings: [],
    feedToken: crypto.randomBytes(16).toString('hex'),
  };
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const db = defaultDb();
    saveDb(db);
    return db;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('DB corrupta, recreando con valores por defecto', e);
    const db = defaultDb();
    saveDb(db);
    return db;
  }
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Carga en memoria + guardado simple (alcanza para el volumen de este caso de uso)
let db = loadDb();
function persist() { saveDb(db); }

// ---------- Helpers de fechas / horarios ----------

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function pad(n) { return n.toString().padStart(2, '0'); }
function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function rangesForPositionDate(pos, d) {
  const key = dateKey(d);
  const specific = (pos.specificDates || []).find(sd => sd.date === key);
  if (specific) return specific.ranges || [];
  const cfg = pos.days[DAY_KEYS[d.getDay()]];
  if (!cfg || !cfg.enabled) return [];
  return cfg.ranges || [];
}

function slotsForPositionDate(pos, d) {
  const ranges = rangesForPositionDate(pos, d);
  if (!ranges.length) return [];
  const dur = pos.duration, gap = pos.gap || 0;
  const key = dateKey(d);
  const taken = new Set(db.bookings.filter(b => b.date === key).map(b => b.time));
  let slots = [];
  ranges.forEach(r => {
    const [sh, sm] = r.start.split(':').map(Number);
    const [eh, em] = r.end.split(':').map(Number);
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    while (cur + dur <= end) {
      const t = pad(Math.floor(cur / 60)) + ':' + pad(cur % 60);
      if (!taken.has(t)) slots.push(t);
      cur += dur + gap;
    }
  });
  slots.sort();
  return slots;
}

function upcomingDatesForPosition(pos, limit = 12, horizonDays = 60) {
  const out = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = dateKey(today);
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    if (rangesForPositionDate(pos, d).length > 0) out.push(dateKey(d));
  }
  // sumar fechas específicas futuras que estén fuera del horizonte de arriba
  (pos.specificDates || []).forEach(sd => {
    if (sd.date >= todayKey && (sd.ranges || []).length > 0 && !out.includes(sd.date)) out.push(sd.date);
  });
  out.sort();
  return out.slice(0, limit);
}

// ---------- Middleware de admin ----------

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Token de administrador inválido o faltante.' });
  }
  next();
}

// ---------- API pública ----------

// Config pública para armar la pantalla de reserva (branding, mensajes, puestos)
app.get('/api/public-config', (req, res) => {
  const publicPositions = db.positions.map(p => ({ id: p.id, name: p.name }));
  res.json({ branding: db.branding, messages: db.messages, positions: publicPositions });
});

// Próximas fechas disponibles para un puesto
app.get('/api/positions/:id/dates', (req, res) => {
  const pos = db.positions.find(p => p.id === req.params.id);
  if (!pos) return res.status(404).json({ error: 'Puesto no encontrado' });
  res.json({ dates: upcomingDatesForPosition(pos) });
});

// Horarios libres para un puesto + fecha (YYYY-MM-DD)
app.get('/api/positions/:id/slots', (req, res) => {
  const pos = db.positions.find(p => p.id === req.params.id);
  if (!pos) return res.status(404).json({ error: 'Puesto no encontrado' });
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Falta el parámetro date=YYYY-MM-DD' });
  const [y, m, d] = date.split('-').map(Number);
  const slots = slotsForPositionDate(pos, new Date(y, m - 1, d));
  res.json({ slots });
});

// Crear una reserva (sin login)
app.post('/api/bookings', (req, res) => {
  const { positionId, date, time, name, email, phone } = req.body || {};
  if (!positionId || !date || !time || !name || !email || !phone) {
    return res.status(400).json({ error: 'Faltan datos obligatorios.' });
  }
  const pos = db.positions.find(p => p.id === positionId);
  if (!pos) return res.status(404).json({ error: 'Puesto no encontrado.' });

  const [y, m, d] = date.split('-').map(Number);
  const freeSlots = slotsForPositionDate(pos, new Date(y, m - 1, d));
  if (!freeSlots.includes(time)) {
    return res.status(409).json({ error: 'Ese horario ya no está disponible. Elegí otro.' });
  }

  const booking = {
    id: uid(),
    positionId: pos.id,
    positionName: pos.name,
    date, time, name, email, phone,
    createdAt: new Date().toISOString(),
  };
  db.bookings.push(booking);
  persist();

  const msg = db.messages.confirmation
    .replace(/\{puesto\}/g, pos.name)
    .replace(/\{fecha\}/g, `${d}/${m}`)
    .replace(/\{hora\}/g, time);

  res.status(201).json({ booking, confirmationMessage: msg });
});

// ---------- Feed ICS EN VIVO (para suscribir en Apple Calendar → Structured) ----------

function buildIcsFeed() {
  const now = db.bookings.filter(b => b.date >= dateKey(new Date()));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Reservas//Entrevistas//ES',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Entrevistas agendadas',
    'X-PUBLISHED-TTL:PT1H', // sugiere a los clientes refrescar cada hora (no todos lo respetan)
  ];
  now.forEach(b => {
    const [y, m, d] = b.date.split('-').map(Number);
    const [hh, mm] = b.time.split(':').map(Number);
    const start = new Date(y, m - 1, d, hh, mm);
    const end = new Date(start.getTime() + 30 * 60000);
    const fmt = dt => dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate()) + 'T' + pad(dt.getHours()) + pad(dt.getMinutes()) + '00';
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + b.id + '@booking-app',
      'DTSTAMP:' + fmt(new Date()) + 'Z',
      'DTSTART:' + fmt(start),
      'DTEND:' + fmt(end),
      'SUMMARY:Entrevista - ' + b.positionName,
      // A propósito no incluimos email/teléfono del postulante en el feed público del calendario, por privacidad.
      'DESCRIPTION:Entrevista con ' + b.name,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

app.get('/feed/:token.ics', (req, res) => {
  if (req.params.token !== db.feedToken) {
    return res.status(404).send('No encontrado');
  }
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.send(buildIcsFeed());
});

// ---------- API de administración (protegida) ----------

app.get('/api/admin/state', requireAdmin, (req, res) => {
  res.json(db);
});

app.post('/api/admin/branding', requireAdmin, (req, res) => {
  db.branding = { logo1: req.body.logo1 ?? null, logo2: req.body.logo2 ?? null };
  persist();
  res.json({ ok: true });
});

app.post('/api/admin/messages', requireAdmin, (req, res) => {
  db.messages = { intro: req.body.intro || '', confirmation: req.body.confirmation || '' };
  persist();
  res.json({ ok: true });
});

app.post('/api/admin/positions', requireAdmin, (req, res) => {
  if (!Array.isArray(req.body.positions)) return res.status(400).json({ error: 'positions debe ser un array' });
  db.positions = req.body.positions;
  persist();
  res.json({ ok: true });
});

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  res.json({ bookings: db.bookings });
});

app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  db.bookings = db.bookings.filter(b => b.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

app.get('/api/admin/feed-url', requireAdmin, (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  res.json({ url: `${proto}://${host}/feed/${db.feedToken}.ics` });
});

app.post('/api/admin/regenerate-feed-token', requireAdmin, (req, res) => {
  db.feedToken = crypto.randomBytes(16).toString('hex');
  persist();
  res.json({ ok: true, feedToken: db.feedToken });
});

// ---------- Frontend estático ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor de reservas escuchando en el puerto ${PORT}`);
  console.log(`Token de administrador (ADMIN_TOKEN): ${ADMIN_TOKEN}`);
});
