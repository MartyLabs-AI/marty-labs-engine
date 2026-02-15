import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import generateRouter from './routes/generate.js';
import feedbackRouter from './routes/feedback.js';
import imagesRouter from './routes/images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/generate', generateRouter);
app.use('/api', feedbackRouter);
app.use('/api/images', imagesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your-key-here',
    hasReplicateKey: !!process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKEN !== 'your-key-here',
  });
});

// Serve frontend in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Marty Labs Creative Engine`);
  console.log(`  ─────────────────────────`);
  console.log(`  Server:  http://localhost:${PORT}`);
  console.log(`  API:     http://localhost:${PORT}/api/health`);
  console.log(`  Claude:  ${process.env.ANTHROPIC_API_KEY ? '✓ Connected' : '✗ Missing key'}`);
  console.log(`  Flux:    ${process.env.REPLICATE_API_TOKEN ? '✓ Connected' : '✗ Missing key'}\n`);
});
