# PVARA AI Licensing - Backend

Express + MongoDB backend for the PVARA AI Licensing Evaluation Platform.

## Quick Start

```bash
npm install
npm run dev
```

## Environment Variables

Create a `.env` file:
```
MONGODB_URI=mongodb://localhost:27017/pvara_ai_eval
OPENAI_API_KEY=sk-your-openai-key
API_KEY=dev-key-12345
NODE_ENV=development
PORT=3001
```

## API Endpoints

- `POST /api/auth/login` - User login
- `GET /api/applications/scan` - List all applications
- `GET /api/applications/:id/evaluate` - Evaluate an application
- `GET /health` - Health check

## Deploy to Vercel

1. Push this repo to GitHub
2. Import to Vercel
3. Set environment variables:
   - `MONGODB_URI` - MongoDB Atlas connection string
   - `OPENAI_API_KEY` - OpenAI API key
   - `API_KEY` - dev-key-12345
4. Deploy

## Default Users

- **Admin:** admin@pvara.gov.pk / pvara@ai
- **Evaluator:** evaluator@pvara.gov.pk / pvara@ai
