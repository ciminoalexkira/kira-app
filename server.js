const express = require('express');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false
}));

app.post('/api/chat', async (req, res) => {
  const { message, voiceEnabled = false } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  console.log(`User: ${message}${voiceEnabled ? ' (voice)' : ''}`);
  
  exec(`openclaw agent -m "${message}" --session-id 121141560`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', stderr);
      return res.status(500).json({ error: stderr });
    }
    res.json({ response: stdout.trim(), voiceEnabled });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kira App running at http://0.0.0.0:${PORT}`);
});
