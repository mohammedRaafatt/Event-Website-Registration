const pool = require('../../database/db.config');

function mapBigInts(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

function normalizeSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function parseMysqlDateTime(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  // datetime-local sends a "floating" local wall time: YYYY-MM-DDTHH:mm[:ss] (no timezone).
  // Do not use Date.parse — it varies by engine/TZ and can shift or reject the string.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const sec = m[6] != null && m[6] !== '' ? Number(m[6]) : 0;
    if (![y, mo, day, h, mi, sec].every((n) => Number.isFinite(n))) return null;
    if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || mi > 59 || sec > 59) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${y}-${pad(mo)}-${pad(day)} ${pad(h)}:${pad(mi)}:${pad(sec)}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

exports.getOverview = async (req, res) => {
  try {
    const p = pool.promise();

    const [[{ user_count: userCount }]] = await p.query('SELECT COUNT(*) AS user_count FROM users');
    const [[{ event_count: eventCount }]] = await p.query('SELECT COUNT(*) AS event_count FROM events');
    const [[{ reg_count: regCount }]] = await p.query(
      "SELECT COUNT(*) AS reg_count FROM registrations WHERE status = 'confirmed'"
    );
    const [[{ tickets_sold: ticketsSold }]] = await p.query(
      "SELECT COALESCE(SUM(quantity), 0) AS tickets_sold FROM registrations WHERE status = 'confirmed'"
    );

    const [users] = await p.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY id ASC LIMIT 200'
    );

    const [events] = await p.query(
      `SELECT
         e.id,
         e.slug,
         e.title,
         e.starts_at,
         e.capacity,
         e.published,
         CAST(COALESCE(SUM(r.quantity), 0) AS BIGINT) AS sold,
         CAST(e.capacity - COALESCE(SUM(r.quantity), 0) AS INTEGER) AS spots_remaining
       FROM events e
       LEFT JOIN registrations r ON r.event_id = e.id AND r.status = 'confirmed'
       GROUP BY e.id, e.slug, e.title, e.starts_at, e.capacity, e.published
       ORDER BY e.starts_at ASC`
    );

    const [recentBookings] = await p.query(
      `SELECT
         r.id,
         r.public_ref,
         r.quantity,
         r.total_cents,
         r.created_at,
         u.name AS user_name,
         u.email AS user_email,
         e.id AS event_id,
         e.title AS event_title
       FROM registrations r
       INNER JOIN users u ON u.id = r.user_id
       INNER JOIN events e ON e.id = r.event_id
       ORDER BY r.created_at DESC
       LIMIT 40`
    );

    return res.json({
      counts: {
        users: Number(userCount),
        events: Number(eventCount),
        registrations: Number(regCount),
        ticketsSold: Number(ticketsSold),
      },
      users: (users || []).map(mapBigInts),
      events: (events || []).map(mapBigInts),
      recentBookings: (recentBookings || []).map(mapBigInts),
    });
  } catch (err) {
    console.error('[admin] getOverview', err && err.message ? err.message : err);
    return res.status(500).json({ message: 'Failed to load admin overview' });
  }
};

exports.listEventsAdmin = async (req, res) => {
  try {
    const [rows] = await pool.promise().query(
      `SELECT id, slug, title, summary, description, location, starts_at, ends_at,
              capacity, price_cents, published, created_at, updated_at
       FROM events ORDER BY starts_at ASC`
    );
    return res.json((rows || []).map(mapBigInts));
  } catch (err) {
    return res.status(500).json({ message: 'Could not load events' });
  }
};

exports.createEvent = async (req, res) => {
  const b = req.body || {};
  let slug = normalizeSlug(b.slug);
  if (!slug) slug = normalizeSlug(b.title);
  const title = String(b.title || '').trim();
  if (!slug || !title) {
    return res.status(400).json({ message: 'title (and optionally slug) are required' });
  }

  const starts = parseMysqlDateTime(b.starts_at);
  if (!starts) {
    return res.status(400).json({ message: 'starts_at must be a valid date/time' });
  }

  const ends = b.ends_at ? parseMysqlDateTime(b.ends_at) : null;
  const capacity = Math.max(1, Math.min(1000000, Number(b.capacity) || 100));
  const priceCents = Math.max(0, Math.min(1_000_000_00, Math.round(Number(b.price_cents) || 0)));
  const published = b.published === false || b.published === 0 ? 0 : 1;
  const summary = b.summary != null ? String(b.summary).slice(0, 400) : null;
  const description = b.description != null ? String(b.description) : '';
  const location = String(b.location || '').slice(0, 220);

  try {
    const [result] = await pool.promise().query(
      `INSERT INTO events (slug, title, summary, description, location, starts_at, ends_at, capacity, price_cents, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [slug, title, summary, description, location, starts, ends, capacity, priceCents, published]
    );
    return res.status(201).json({ id: result[0].id, slug });
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.code === '23505')) {
      return res.status(409).json({ message: 'Slug already in use — pick another slug' });
    }
    console.error('[admin] createEvent', err && err.message ? err.message : err);
    return res.status(500).json({ message: 'Could not create event' });
  }
};

exports.updateEvent = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id' });
  }

  const b = req.body || {};
  const fields = [];
  const values = [];

  if (b.slug !== undefined) {
    const slug = normalizeSlug(b.slug);
    if (!slug) return res.status(400).json({ message: 'slug cannot be empty' });
    fields.push('slug = ?');
    values.push(slug);
  }
  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title) return res.status(400).json({ message: 'title cannot be empty' });
    fields.push('title = ?');
    values.push(title);
  }
  if (b.summary !== undefined) {
    fields.push('summary = ?');
    values.push(b.summary == null ? null : String(b.summary).slice(0, 400));
  }
  if (b.description !== undefined) {
    fields.push('description = ?');
    values.push(String(b.description));
  }
  if (b.location !== undefined) {
    fields.push('location = ?');
    values.push(String(b.location).slice(0, 220));
  }
  if (b.starts_at !== undefined) {
    const starts = parseMysqlDateTime(b.starts_at);
    if (!starts) return res.status(400).json({ message: 'starts_at invalid' });
    fields.push('starts_at = ?');
    values.push(starts);
  }
  if (b.ends_at !== undefined) {
    const ends = b.ends_at ? parseMysqlDateTime(b.ends_at) : null;
    fields.push('ends_at = ?');
    values.push(ends);
  }
  if (b.capacity !== undefined) {
    const cap = Number(b.capacity);
    if (!Number.isFinite(cap) || cap < 1) return res.status(400).json({ message: 'capacity invalid' });
    fields.push('capacity = ?');
    values.push(Math.min(1000000, Math.round(cap)));
  }
  if (b.price_cents !== undefined) {
    const pc = Math.round(Number(b.price_cents));
    if (!Number.isFinite(pc) || pc < 0) return res.status(400).json({ message: 'price_cents invalid' });
    fields.push('price_cents = ?');
    values.push(Math.min(1_000_000_00, pc));
  }
  if (b.published !== undefined) {
    fields.push('published = ?');
    values.push(b.published === false || b.published === 0 ? 0 : 1);
  }

  if (!fields.length) {
    return res.status(400).json({ message: 'No fields to update' });
  }

  values.push(id);

  try {
    const [result] = await pool.promise().query(
      `UPDATE events SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Event not found' });
    return res.json({ message: 'Event updated' });
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.code === '23505')) {
      return res.status(409).json({ message: 'Slug conflict' });
    }
    return res.status(500).json({ message: 'Could not update event' });
  }
};

exports.deleteEvent = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id' });
  }

  try {
    const p = pool.promise();
    const [[{ c }]] = await p.query(
      "SELECT COUNT(*) AS c FROM registrations WHERE event_id = ? AND status = 'confirmed'",
      [id]
    );
    if (Number(c) > 0) {
      return res.status(409).json({
        message: 'Cannot delete an event that already has registrations. Unpublish it instead.',
      });
    }
    const [result] = await p.query('DELETE FROM events WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Event not found' });
    return res.json({ message: 'Event deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Could not delete event' });
  }
};
