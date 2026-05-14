const crypto = require('crypto');
const pool = require('../../database/db.config');

const MAX_PER_ORDER = 50;

function mapRow(row) {
  if (!row || typeof row !== 'object') return row;
  const o = { ...row };
  for (const k of Object.keys(o)) {
    if (typeof o[k] === 'bigint') o[k] = Number(o[k]);
  }
  return o;
}

exports.listMine = (req, res) => {
  const userId = req.user.userId;

  pool.query(
    `SELECT r.public_ref,
            r.quantity,
            r.total_cents,
            r.status,
            r.created_at,
            e.id AS event_id,
            e.slug AS event_slug,
            e.title AS event_title,
            e.location,
            e.starts_at,
            e.price_cents
     FROM registrations r
     INNER JOIN events e ON e.id = r.event_id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Could not load registrations' });
      return res.json((rows || []).map(mapRow));
    }
  );
};

exports.getByRef = (req, res) => {
  const { ref } = req.params;
  const userId = req.user.userId;

  if (!ref || String(ref).length !== 10) {
    return res.status(400).json({ message: 'Invalid reference' });
  }

  pool.query(
    `SELECT r.public_ref,
            r.quantity,
            r.total_cents,
            r.status,
            r.created_at,
            e.id AS event_id,
            e.slug AS event_slug,
            e.title AS event_title,
            e.location,
            e.starts_at,
            e.ends_at
     FROM registrations r
     INNER JOIN events e ON e.id = r.event_id
     WHERE r.public_ref = ? AND r.user_id = ?
     LIMIT 1`,
    [ref, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Could not load registration' });
      if (!rows || rows.length === 0) return res.status(404).json({ message: 'Registration not found' });
      return res.json(mapRow(rows[0]));
    }
  );
};

exports.create = async (req, res) => {
  const userId = req.user.userId;
  const { eventId, quantity } = req.body;

  if (!eventId) {
    return res.status(400).json({ message: 'eventId is required' });
  }

  const eid = Number(eventId);
  if (!Number.isInteger(eid) || eid <= 0) {
    return res.status(400).json({ message: 'eventId must be a positive integer' });
  }

  const qty = Number(quantity || 1);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_PER_ORDER) {
    return res.status(400).json({ message: `quantity must be an integer from 1 to ${MAX_PER_ORDER}` });
  }

  let conn;
  try {
    conn = await pool.promise().getConnection();
    await conn.beginTransaction();

    const [[eventRow]] = await conn.query(
      `SELECT id, capacity, price_cents, published
       FROM events WHERE id = ? FOR UPDATE`,
      [eid]
    );

    if (!eventRow || !eventRow.published) {
      await conn.rollback();
      return res.status(404).json({ message: 'Event not found or not open for registration' });
    }

    const [[agg]] = await conn.query(
      `SELECT COALESCE(SUM(quantity), 0) AS sold
       FROM registrations
       WHERE event_id = ? AND status = 'confirmed' FOR UPDATE`,
      [eid]
    );

    const sold = Number(agg.sold) || 0;
    const cap = Number(eventRow.capacity) || 0;
    const remaining = cap - sold;

    if (qty > remaining) {
      await conn.rollback();
      return res.status(400).json({
        message:
          remaining <= 0
            ? 'This event is full'
            : `Only ${remaining} seat(s) still available for this event`,
      });
    }

    const unit = Number(eventRow.price_cents) || 0;
    const totalCents = unit * qty;

    let publicRef = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = crypto.randomBytes(5).toString('hex');
      try {
        await conn.query(
          `INSERT INTO registrations (public_ref, user_id, event_id, quantity, total_cents, status)
           VALUES (?, ?, ?, ?, ?, 'confirmed')`,
          [candidate, userId, eid, qty, totalCents]
        );
        publicRef = candidate;
        break;
      } catch (err) {
        if (err && (err.code === 'ER_DUP_ENTRY' || err.code === '23505')) continue;
        throw err;
      }
    }

    if (!publicRef) {
      await conn.rollback();
      return res.status(500).json({ message: 'Could not complete registration' });
    }

    await conn.commit();

    return res.status(201).json({
      message: 'Registration confirmed',
      reference: publicRef,
      quantity: qty,
      total_cents: totalCents,
      event_id: eid,
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {
        /* ignore */
      }
    }
    return res.status(500).json({ message: 'Registration failed' });
  } finally {
    if (conn) conn.release();
  }
};
