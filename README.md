# Marty Labs Creative Engine

AI-powered content creation pipeline for performance creatives.

## Stack
- **Backend**: Node.js + Express
- **AI**: Claude Opus (Anthropic) for concept/script generation
- **Images**: Flux 2 Klein (Replicate) for storyboard frames
- **Frontend**: React + TypeScript + Tailwind
- **Memory**: Persistent JSON storage (all feedback survives restarts)

## Quick Start

```bash
# 1. Clone and install
git clone <your-repo>
cd marty-labs-engine
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 3. Build frontend
npm run build

# 4. Start server
npm start
# → http://localhost:3001
```

## Development

```bash
npm run dev  # Runs backend + Vite dev server concurrently
```

## Deploy with Docker

```bash
# Build and run
docker-compose up -d

# Or manually
docker build -t marty-engine .
docker run -p 3001:3001 --env-file .env -v engine-data:/app/server/memory/data marty-engine
```

## Deploy to a VPS (for team access)

1. Get a VPS (DigitalOcean, Railway, Render, Fly.io)
2. Clone repo, set up `.env` with your keys
3. `docker-compose up -d`
4. Point your domain to the VPS IP
5. Share the URL with your team

### Railway (easiest)
1. Push to GitHub
2. Connect Railway to your repo
3. Add environment variables in Railway dashboard
4. Deploy — you get a public URL instantly

### Render
1. Create a new Web Service from your repo
2. Set build command: `npm install && npm run build`
3. Set start command: `node server/index.js`
4. Add environment variables
5. Deploy

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `REPLICATE_API_TOKEN` | Replicate API key for Flux image generation |
| `PORT` | Server port (default: 3001) |
| `MEMORY_PATH` | Path for persistent memory storage |

## How It Works

1. **Create a project** (e.g. "Matiks Q1 Campaign")
2. **Generate strategies** — Claude creates strategic pillars based on brand context
3. **Approve/reject/comment** — every decision is stored permanently
4. **Generate concepts** — Claude uses your feedback history to create better concepts each time
5. **Generate scripts** — detailed shot-by-shot scripts from approved concepts
6. **Generate storyboards** — Flux creates visual frames from approved scripts
7. **Iterate** — mark items for revision, Claude rewrites with your feedback baked in

The memory system means Claude gets smarter about your preferences over time. Every approval, rejection, and comment is fed back into the next generation call.
