const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const WebSocket = require('ws');

const app = express();
const PORT = 3000;

// Google Generative AI - diretta integrazione
const API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyCerpCHBZI-89HCMd0S50uPHe47pO3cEsU';
const MODEL_LITE = 'gemini-2.5-flash-lite';
const MODEL_PRO = 'gemini-2.5-pro';
const MODEL_ULTRA = 'gemini-2.5-ultra'; // Assumendo che questo sia un modello valido

const ai = new GoogleGenerativeAI(API_KEY);
let modelLite, modelPro, modelUltra;

try {
  modelLite = ai.getGenerativeModel({ model: MODEL_LITE });
  modelPro = ai.getGenerativeModel({ model: MODEL_PRO });
  modelUltra = ai.getGenerativeModel({ model: MODEL_ULTRA });
} catch (error) {
  console.error('Error initializing Gemini models:', error);
  // Gestisci l'errore, magari fallisci il bootstrap o usa un fallback
}

// SQLite Database
const dbPath = path.join(__dirname, 'kira-chat.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database open error:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

function initDatabase() {
  db.serialize(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'alessandro',
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        structured INTEGER DEFAULT 0,
        audio_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        session_id TEXT,
        model TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'alessandro',
        device_id TEXT NOT NULL,
        session_id TEXT UNIQUE NOT NULL,
        last_seen TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);
  });
}

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
  try {
    const history = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all('alessandro');
    res.json({ messages: history });
  } catch (e) {
    console.error('History error:', e);
    res.status(500).json({ error: e.message });
  }
});

// API: Get paginated messages
app.get('/api/chat/messages', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const messages = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all('alessandro', limit, offset);
    const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE user_id = ?').get('alessandro');
    res.json({
      messages,
      hasMore: offset + limit < count.count,
      offset: offset + limit
    });
  } catch (e) {
    console.error('Messages error:', e);
    res.status(500).json({ error: e.message });
  }
});

// API: Save message
app.post('/api/chat/messages', (req, res) => {
  try {
    const { type, text, structured, audio_url, model } = req.body;
    const stmt = db.prepare('INSERT INTO messages (type, text, structured, audio_url, session_id, user_id, model) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(type, text, structured ? 1 : 0, audio_url, req.sessionId, 'alessandro', model);
    res.json({ success: true, id: result.lastID });
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

// API: Switch manuale modello
app.post('/api/switch-model', (req, res) => {
  try {
    const { model } = req.body; // 'lite', 'pro', 'ultra'
    
    const modelMap = {
      'lite': { model: 'gemini-2.5-flash-lite', modelName: 'Gemini 2.5 Flash Lite' },
      'flash': { model: 'gemini-2.5-flash', modelName: 'Gemini 2.5 Flash' },
      'pro': { model: 'gemini-2.5-pro', modelName: 'Gemini 2.5 Pro' },
      'ultra': { model: 'gemini-2.5-ultra', modelName: 'Gemini 2.5 Ultra' }
    };
    
    const selected = modelMap[model] || modelMap.lite;
    
    res.json({
      model: selected.model,
      modelName: selected.modelName,
      reason: 'Modello manuale selezionato'
    });
  } catch (e) {
    console.error('Switch model error:', e);
    res.status(500).json({ error: e.message });
  }
});

// MAIN chat endpoint - diretta integrazione Gemini
app.post('/api/chat', async (req, res) => {
  const { message, voiceEnabled = false, forceModel } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  console.log(`User: ${message}${voiceEnabled ? ' (voice)' : ''}`);

  // Analizza intent e assegna modello
  const intent = analyzeIntent(message);
  let modelToUse;
  let modelName;
  let reason;

  if (forceModel) {
    // Override manuale
    if (forceModel === 'pro') {
      modelToUse = ai.getGenerativeModel({ model: GEMINI_MODELS.PRO.model });
      modelName = GEMINI_MODELS.PRO.model;
      reason = 'Forzato modello Pro';
    } else if (forceModel === 'ultra') {
      modelToUse = ai.getGenerativeModel({ model: GEMINI_MODELS.ULTRA.model });
      modelName = GEMINI_MODELS.ULTRA.model;
      reason = 'Forzato modello Ultra';
    } else { // Default to Flash Lite if forceModel is unrecognized
      modelToUse = ai.getGenerativeModel({ model: GEMINI_MODELS.FLASH_LITE.model });
      modelName = GEMINI_MODELS.FLASH_LITE.model;
      reason = 'Forzato modello Lite';
    }
  } else {
    // Routing automatico basato sull'intent
    if (intent.model === 'lite') {
      modelToUse = ai.getGenerativeModel({ model: GEMINI_MODELS.FLASH_LITE.model });
      modelName = GEMINI_MODELS.FLASH_LITE.model;
      reason = intent.reason;
    } else if (intent.model === 'flash') {
      modelToUse = ai.getGenerativeModel({ model: GEMINI_MODELS.FLASH.model });
      modelName = GEMINI_MODELS.FLASH.model;
      reason = intent.reason;
    } else { // Default to Pro for any other case including 'pro' or unknown intents
      modelToUse = ai.getGenerativeModel({ model: GEMINI_MODELS.PRO.model });
      modelName = GEMINI_MODELS.PRO.model;
      reason = intent.reason || 'default pro';
    }
  }

  try {
    console.log(`Intent: ${reason} → Model: ${modelName}`);

    // Chiamata diretta a Gemini API
    const result = await modelToUse.generateContent(message);
    const aiResponse = result.response.text();

    try {
      // Save user message to database
      const isStructured = isStructuredContent(message);
      const stmt = db.prepare('INSERT INTO messages (type, text, structured, session_id, user_id, model) VALUES (?, ?, ?, ?, ?, ?)');
      stmt.run('user', message, isStructured ? 1 : 0, req.sessionId, 'alessandro', modelName);

      // Save AI response to database
      const aiIsStructured = isStructuredContent(aiResponse);
      const stmt2 = db.prepare('INSERT INTO messages (type, text, structured, session_id, user_id, model) VALUES (?, ?, ?, ?, ?, ?)');
      stmt2.run('ai', aiResponse, aiIsStructured ? 1 : 0, req.sessionId, 'alessandro', modelName);

      // Inietta info sul modello nella risposta
      const modelInfo = `\n\n[⚡ Modello: ${reason} (${modelName})]`;
      
      res.json({ 
        response: aiResponse + modelInfo,
        model: modelName,
        modelDisplayName: intent.modelName || 'Gemini',
        voiceEnabled
      });
    } catch (dbError) {
      console.error('Database error:', dbError);
      // Return AI response even if DB fails
      res.json({ response: aiResponse, model: modelName, modelDisplayName: intent.modelName || 'Gemini', voiceEnabled });
    }
  } catch (aiError) {
    console.eprror('Gemini API error:', aiError);
    res.status(500).json({ error: 'Gemini API error: ' + aiError.message });
  }
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
  console.log('Gemini API keys configured.');
});

function isStructuredContent(text) {
  return /```|https?:\/\/|www\.|`|\$|>|</.test(text);
}
