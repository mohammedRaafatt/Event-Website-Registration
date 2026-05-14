const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../database/db.config');

const jwtSecret = () => process.env.JWT_SECRET || 'dev_secret';

exports.login = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  const normalized = String(email).trim().toLowerCase();

  pool.query(
    'SELECT id, name, email, password, role FROM users WHERE LOWER(TRIM(email)) = ?',
    [normalized],
    async (err, results) => {
      if (err) return res.status(500).json({ message: 'Login failed' });
      if (!results || results.length === 0) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const user = results[0];
      const isMatch = await bcrypt.compare(password, user.password).catch(() => false);
      if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

      const token = jwt.sign(
        { userId: user.id, role: user.role, email: user.email, name: user.name },
        jwtSecret(),
        { expiresIn: '7d' }
      );

      return res.json({
        message: 'Login successful',
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    }
  );
};

exports.register = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name, email, and password are required' });
  }

  const trimmedName = String(name).trim();
  const trimmedEmail = String(email).trim().toLowerCase();

  if (trimmedName.length < 2) {
    return res.status(400).json({ message: 'name is too short' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return res.status(400).json({ message: 'invalid email' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'password must be at least 6 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.promise().query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?) RETURNING id',
      [trimmedName, trimmedEmail, hash, 'attendee']
    );

    const userId = result[0].id;
    const token = jwt.sign(
      {
        userId,
        role: 'attendee',
        email: trimmedEmail,
        name: trimmedName,
      },
      jwtSecret(),
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'Account created',
      token,
      user: { id: userId, name: trimmedName, email: trimmedEmail, role: 'attendee' },
    });
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.code === '23505')) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }
    return res.status(500).json({ message: 'Registration failed' });
  }
};
