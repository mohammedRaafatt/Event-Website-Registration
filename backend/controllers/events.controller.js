const pool = require('../../database/db.config');

function num(v) {
  if (v == null) return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function normalizeEventRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    id: num(row.id),
    capacity: num(row.capacity),
    price_cents: num(row.price_cents),
    spots_remaining: num(row.spots_remaining),
    published: row.published != null ? num(row.published) : row.published,
  };
}

const publicFields = `
  e.id,
  e.slug,
  e.title,
  e.summary,
  e.description,
  e.location,
  e.starts_at,
  e.ends_at,
  e.capacity,
  e.price_cents,
  CAST(
    e.capacity - COALESCE((
      SELECT SUM(r.quantity) FROM registrations r
      WHERE r.event_id = e.id AND r.status = 'confirmed'
    ), 0) AS INTEGER
  ) AS spots_remaining
`;

const baseFrom = `FROM events e`;

exports.listPublished = (req, res) => {
  const sql = `SELECT ${publicFields} ${baseFrom} WHERE e.published = 1 ORDER BY e.starts_at ASC`;
  pool.query(sql, (err, rows) => {
    if (err) {
      console.error('[events] listPublished', err.message);
      return res.status(500).json({ message: 'Could not load events' });
    }
    const out = (rows || []).map(normalizeEventRow);
    return res.json(out);
  });
};

exports.getBySlug = (req, res) => {
  const { slug } = req.params;
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ message: 'Invalid slug' });
  }

  const sql = `SELECT ${publicFields} ${baseFrom} WHERE e.slug = ? AND e.published = 1 LIMIT 1`;
  pool.query(sql, [slug.trim()], (err, rows) => {
    if (err) {
      console.error('[events] getBySlug', err.message);
      return res.status(500).json({ message: 'Could not load event' });
    }
    if (!rows || rows.length === 0) return res.status(404).json({ message: 'Event not found' });
    return res.json(normalizeEventRow(rows[0]));
  });
};

exports.getById = (req, res) => {
  const raw = req.params.id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).json({ message: 'Event not found' });
  }

  const sql = `SELECT ${publicFields} ${baseFrom} WHERE e.id = ? AND e.published = 1 LIMIT 1`;
  pool.query(sql, [id], (err, rows) => {
    if (err) {
      console.error('[events] getById', err.message);
      return res.status(500).json({ message: 'Could not load event' });
    }
    if (!rows || rows.length === 0) return res.status(404).json({ message: 'Event not found' });
    return res.json(normalizeEventRow(rows[0]));
  });
};
