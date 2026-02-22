const express = require('express');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  console.log(`User: ${message}`);
  
  exec(`openclaw agent "${message}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', stderr);
      return res.status(500).json({ error: stderr });
    }
    res.json({ response: stdout.trim() });
  });
});

app.listen(PORT, () => {
  console.log(`Kira App running at http://localhost:${PORT}`);
});
