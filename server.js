const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const edgeTTS = require('node-edge-tts');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  try {
    console.log('TTS request:', text.substring(0, 50) + '...');
    
    // Edge TTS - voce italiana
    const audio = await edgeTTS({
      text: text,
      voice: 'it-IT-ElsaNeural',
      lang: 'it-IT',
      outputFormat: 'mp3',
      rate: '+0%'
    });
    
    // Salva temporaneamente
    const filename = `tts-${Date.now()}.mp3`;
    const fs = require('fs');
    const filepath = path.join(__dirname, 'public', 'tts', filename);
    
    if (!require('fs').existsSync(path.join(__dirname, 'public', 'tts'))) {
      fs.mkdirSync(path.join(__dirname, 'public', 'tts'));
    }
    
    fs.writeFileSync(filepath, audio);
    
    res.json({ 
      audioUrl: `/tts/${filename}`,
      voice: 'it-IT-ElsaNeural'
    });
  } catch (error) {
    console.error('TTS Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message, voiceEnabled = false } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  console.log(`User: ${message}${voiceEnabled ? ' (voice)' : ''}`);
  
  exec(`openclaw agent "${message}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', stderr);
      return res.status(500).json({ error: stderr });
    }
    res.json({ response: stdout.trim(), voiceEnabled });
  });
});

app.listen(PORT, () => {
  console.log(`Kira App running at http://localhost:${PORT}`);
});
