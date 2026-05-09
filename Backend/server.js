// server.js
require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const rateLimit      = require('express-rate-limit');
const path           = require('path');
const mysql          = require('mysql2/promise');
const bcrypt         = require('bcryptjs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database pool ──────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host     : process.env.DB_HOST || 'localhost',
  user     : process.env.DB_USER || 'root',
  password : process.env.DB_PASS || '',
  database : process.env.DB_NAME || 'crm_db',
  waitForConnections: true,
  connectionLimit   : 10,
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret           : process.env.SESSION_SECRET || 'crm-super-secret-2024',
  resave           : false,
  saveUninitialized: false,
  cookie           : { secure: false, maxAge: 8 * 60 * 60 * 1000 }, // 8 h
}));

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'Too many login attempts' } });

// ── Auth guard ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Public routes ──────────────────────────────────────────────────────────

// External contact-form submission (no auth required)
app.post('/api/public/leads', async (req, res) => {
  try {
    const { name, email, phone='', company='', source='Website', message='' } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    const [result] = await pool.query(
      `INSERT INTO leads (name,email,phone,company,source,message) VALUES (?,?,?,?,?,?)`,
      [name, email, phone, company, source, message]
    );
    res.json({ success: true, id: result.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── Auth routes ────────────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM admins WHERE username=?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok)  return res.status(401).json({ error: 'Invalid credentials' });
    req.session.adminId = rows[0].id;
    req.session.username = rows[0].username;
    res.json({ success: true, username: rows[0].username });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.adminId)
    return res.json({ loggedIn: true, username: req.session.username });
  res.json({ loggedIn: false });
});

// ── Protected: Leads ───────────────────────────────────────────────────────
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const { status, search, sort='created_at', order='DESC' } = req.query;
    const safeSort  = ['created_at','name','status','priority','updated_at'].includes(sort) ? sort : 'created_at';
    const safeOrder = order === 'ASC' ? 'ASC' : 'DESC';
    let sql = 'SELECT * FROM leads WHERE 1=1';
    const params = [];
    if (status && status !== 'all') { sql += ' AND status=?'; params.push(status); }
    if (search) { sql += ' AND (name LIKE ? OR email LIKE ? OR company LIKE ?)'; const s=`%${search}%`; params.push(s,s,s); }
    sql += ` ORDER BY ${safeSort} ${safeOrder}`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const [leads] = await pool.query('SELECT * FROM leads WHERE id=?', [req.params.id]);
    if (!leads.length) return res.status(404).json({ error: 'Not found' });
    const [notes] = await pool.query(
      'SELECT n.*,a.username FROM notes n LEFT JOIN admins a ON n.admin_id=a.id WHERE n.lead_id=? ORDER BY n.created_at DESC',
      [req.params.id]
    );
    res.json({ lead: leads[0], notes });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/leads', requireAuth, async (req, res) => {
  try {
    const { name, email, phone='', company='', source='Manual', status='new', priority='medium', message='' } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    const [result] = await pool.query(
      `INSERT INTO leads (name,email,phone,company,source,status,priority,message) VALUES (?,?,?,?,?,?,?,?)`,
      [name, email, phone, company, source, status, priority, message]
    );
    res.json({ success: true, id: result.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const { name, email, phone, company, source, status, priority, message } = req.body;
    await pool.query(
      `UPDATE leads SET name=?,email=?,phone=?,company=?,source=?,status=?,priority=?,message=? WHERE id=?`,
      [name, email, phone, company, source, status, priority, message, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/leads/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['new','contacted','converted','lost'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await pool.query('UPDATE leads SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/leads/:id/notes', requireAuth, async (req, res) => {
  try {
    const { content, follow_up=null } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });
    const [result] = await pool.query(
      `INSERT INTO notes (lead_id,admin_id,content,follow_up) VALUES (?,?,?,?)`,
      [req.params.id, req.session.adminId, content, follow_up || null]
    );
    res.json({ success: true, id: result.insertId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/notes/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM notes WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Stats
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const [[totals]]   = await pool.query(`SELECT COUNT(*) as total, SUM(status='new') as new_leads, SUM(status='contacted') as contacted, SUM(status='converted') as converted, SUM(status='lost') as lost FROM leads`);
    const [bySrc]      = await pool.query(`SELECT source, COUNT(*) as count FROM leads GROUP BY source ORDER BY count DESC LIMIT 6`);
    const [recent]     = await pool.query(`SELECT id,name,email,status,created_at FROM leads ORDER BY created_at DESC LIMIT 5`);
    const [followUps]  = await pool.query(`SELECT l.id,l.name,n.follow_up,n.content FROM notes n JOIN leads l ON n.lead_id=l.id WHERE n.follow_up IS NOT NULL AND n.follow_up >= CURDATE() ORDER BY n.follow_up ASC LIMIT 5`);
    res.json({ totals, bySrc, recent, followUps });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀  CRM running on http://localhost:${PORT}`));
