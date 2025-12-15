# Environment Variables for Backend Deployment

## Required Environment Variables

### MongoDB Configuration
```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
DB_NAME=pvara_ai_eval
```

### OpenAI Configuration
```
OPENAI_API_KEY=sk-proj-...your-api-key...
OPENAI_MODEL=gpt-4o
OPENAI_MAX_TOKENS=2500
OPENAI_ASSISTANT_ID=asst_...optional_assistant_with_file_search
OPENAI_GLOBAL_DAILY_BUDGET_TOKENS=500000
OPENAI_TENANT_DAILY_QUOTA_TOKENS=100000
OPENAI_MAX_RETRIES=3
OPENAI_CIRCUIT_BREAK_THRESHOLD=5
OPENAI_CIRCUIT_BREAK_COOLDOWN_MS=300000
OPENAI_CACHE_TTL_MS=3600000
OPENAI_DEFAULT_TENANT_ID=global
```

### Server Configuration
```
PORT=3001
NODE_ENV=production
```

### JWT Configuration
```
JWT_SECRET=your-secure-random-secret-key-here
```

### Evaluation Weights (Optional - defaults provided)
```
EVAL_WEIGHT_COMPLIANCE=0.40
EVAL_WEIGHT_SECURITY=0.30
EVAL_WEIGHT_DOCS=0.15
EVAL_WEIGHT_TECHNICAL=0.15
```

### Risk Thresholds (Optional - defaults provided)
```
RISK_THRESHOLD_CRITICAL=80
RISK_THRESHOLD_HIGH=60
RISK_THRESHOLD_MEDIUM=40
```

## Setup Instructions for Vercel

1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add each variable listed above
4. For production MongoDB, consider using MongoDB Atlas:
   - Sign up at https://www.mongodb.com/cloud/atlas
   - Create a cluster
   - Get connection string
   - Replace `<username>`, `<password>`, and `<cluster>` with your values

## Security Notes

- Never commit `.env` files to git
- Use strong, random values for JWT_SECRET
- Restrict MongoDB access to Vercel IP addresses
- Keep OpenAI API keys secure and rotate regularly
