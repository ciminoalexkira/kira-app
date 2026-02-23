const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

// SQLite Database
const dbPath = path.join(__dirname, 'kira-chat.db');
const db = new Database(dbPath);

// Initialize database
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'alessandro',
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    structured INTEGER DEFAULT 0,
    audio_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    session_id TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'alessandro',
    device_id TEXT NOT NULL,
    session_id TEXT UNIQUE NOT NULL,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false
}));

// Middleware: device identification
app.use((req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.ip || 'unknown';
  req.deviceId = userAgent + '-' + ip;
  req.sessionId = req.headers['x-session-id'] || generateSessionId();
  next();
});

function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// API: Get full history
app.get('/api/chat/history', (req, res) => {
  const history = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all('alessandro');
  res.json({ messages: history });
});

// API: Get paginated messages
app.get('/api/chat/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const messages = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all('alessandro', limit, offset);
  const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE user_id = ?').get('alessandro');
  res.json({ 
    messages,
    hasMore: offset + limit < count.count,
    offset: offset + limit
  });
});

// API: Save message
app.post('/api/chat/messages', (req, res) => {
  try {
    const { type, text, structured, audio_url } = req.body;
    const stmt = db.prepare('INSERT INTO messages (type, text, structured, audio_url, session_id, user_id) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(type, text, structured ? 1 : 0, audio_url, req.sessionId, 'alessandro');
    res.json({ success: true, id: this.lastID });
  } catch (e) {
    console.error('Save message error:', e);
    res.status(500).json({ error: e.message });
  }
});

// API: Update or create session
app.post('/api/chat/sync', (req, res) => {
  try {
    const { session_id, last_seen } = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO sessions (device_id, session_id, last_seen, user_id) VALUES (?, ?, ?, ?)');
    stmt.run(req.deviceId, session_id, last_seen || new Date().toISOString(), 'alessandro');
    res.json({ success: true });
  } catch (e) {
    console.error('Sync error:', e);
    res.status(500).json({ error: e.message });
  }
});

// API: Delete old messages
app.delete('/api/chat/history', (req, res) => {
  try {
    const olderThan = req.query.olderThan;
    if (!olderThan) {
      return res.status(400).json({ error: 'olderThan required' });
    }
    const result = db.prepare('DELETE FROM messages WHERE user_id = ? AND created_at < datetime(?)').run(olderThan, 'alessandro');
    res.json({ deleted: result.changes });
  } catch (e) {
    console.error('Delete error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Original chat endpoint
app.post('/api/chat', async (req, res) => {
  const { message, voiceEnabled = false } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  console.log(`User: ${message}${voiceEnabled ? ' (voice)' : ''}`);

  exec(`openclaw agent -m "${message}" --session-id 121141560`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', stderr);
      return res.status(500).json({ error: stderr });
    }

    const aiResponse = stdout.trim();

    try {
      // Save user message to database
      const isStructured = isStructuredContent(message);
      const stmt = db.prepare('INSERT INTO messages (type, text, structured, session_id, user_id) VALUES (?, ?, ?, ?, ?)');
      stmt.run('user', message, isStructured ? 1 : 0, req.sessionId, 'alessandro');

      // Save AI response to database
      const aiIsStructured = isStructuredContent(aiResponse);
      const stmt2 = db.prepare('INSERT INTO messages (type, text, structured, session_id, user_id) VALUES (?, ?, ?, ?, ?)');
      stmt2.run('ai', aiResponse, aiIsStructured ? 1 : 0, req.sessionId, 'alessandro');

      res.json({ response: aiResponse, voiceEnabled });
    } catch (dbError) {
      console.error('Database error:', dbError);
      // Return AI response even if DB fails
      res.json({ response: aiResponse, voiceEnabled });
    }
  });
});

// Update session heartbeat
app.use((req, res, next) => {
  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO sessions (device_id, session_id, last_seen, user_id) VALUES (?, ?, CURRENT_TIMESTAMP, ?)');
    stmt.run(req.deviceId, req.sessionId, 'alessandro');
  } catch (e) {
    console.error('Session update error:', e);
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kira App running at http://0.0.0.0:${PORT}`);
  console.log(`SQLite database: ${dbPath}`);
});

function isStructuredContent(text) {
  return /```|https?:\/\/|www\.|`|\$|>|</.test(text);
}
