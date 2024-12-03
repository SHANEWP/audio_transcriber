require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const ffmpegPath = require('ffmpeg-static'); // Import ffmpeg-static
const ffmpeg = require('fluent-ffmpeg');

// Set FFmpeg binary path for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const port = 3000;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads
const upload = multer({
  dest: 'uploads/',
});

// OpenAI API Key from .env file
const OPENAI_API_KEY = process.env.OPEN_AI_KEY;
if (!OPENAI_API_KEY) {
  console.error('Error: OPEN_AI_KEY is not set in .env file');
  process.exit(1);
}

// Supported file extensions and MIME types
const SUPPORTED_EXTENSIONS = ['.flac', '.m4a', '.mp3', '.mp4', '.mpeg', '.mpga', '.oga', '.ogg', '.wav', '.webm'];
const mimeTypeMapping = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/x-m4a',
};

// Utility function to preprocess audio file
async function preprocessAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-ar 16000', '-ac 1']) // Set sample rate to 16kHz and mono channel
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));
  });
}

// Utility function to transcribe audio file using OpenAI Whisper API
async function transcribeAudio(filePath, mimeType) {
  const audioData = fs.createReadStream(filePath);

  const formData = new FormData();
  formData.append('file', audioData, {
    filename: path.basename(filePath),
    contentType: mimeType,
  });
  formData.append('model', 'whisper-1');

  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
    });
    return response.data.text;
  } catch (error) {
    if (error.response) {
      console.error('API Response Error:', error.response.status, error.response.data);
    } else {
      console.error('Error with OpenAI API:', error.message);
    }
    throw error;
  }
}

// Route to handle file uploads and transcription
app.post('/upload', upload.array('audioFiles', 10), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  const transcriptions = {};

  for (const file of files) {
    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(fileExtension)) {
      transcriptions[file.originalname] = 'Unsupported file type.';
      continue;
    }

    try {
      const mimeType = mimeTypeMapping[fileExtension] || file.mimetype;
      let filePath = file.path;

      if (fileExtension === '.wav') {
        const tempProcessedFile = `processed_${file.filename}.wav`;
        await preprocessAudio(file.path, tempProcessedFile);
        filePath = tempProcessedFile;
      }

      const transcription = await transcribeAudio(filePath, mimeType);
      transcriptions[file.originalname] = transcription;

      if (filePath !== file.path) {
        fs.unlinkSync(filePath); // Clean up preprocessed file
      }
    } catch (err) {
      console.error(`Error transcribing file ${file.originalname}:`, err);
      transcriptions[file.originalname] = 'Error during transcription.';
    } finally {
      fs.unlinkSync(file.path); // Clean up original uploaded file
    }
  }

  res.json(transcriptions);
});

// Route to handle transcription of all audio files in a directory
app.post('/transcribe-directory', express.json(), async (req, res) => {
  const { directoryPath } = req.body;

  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return res.status(400).send('Invalid directory path.');
  }

  const files = fs
    .readdirSync(directoryPath)
    .filter((file) => SUPPORTED_EXTENSIONS.includes(path.extname(file).toLowerCase()));

  const transcriptions = {};

  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    try {
      const mimeType = mimeTypeMapping[path.extname(file).toLowerCase()] || `audio/${path.extname(file).substring(1)}`;
      const transcription = await transcribeAudio(filePath, mimeType);
      transcriptions[file] = transcription;
    } catch (err) {
      console.error(`Error transcribing file ${file}:`, err);
      transcriptions[file] = 'Error during transcription.';
    }
  }

  res.json(transcriptions);
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
