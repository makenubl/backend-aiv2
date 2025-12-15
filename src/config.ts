import dotenv from 'dotenv';
import path from 'path';

// Try loading .env from both source and dist locations
const envPath = path.resolve(__dirname, '../.env');
const envPath2 = path.resolve(__dirname, '../../.env');
const envPath3 = path.resolve(process.cwd(), '.env');

// Try multiple paths
dotenv.config({ path: envPath });
if (!process.env.OPENAI_API_KEY) {
  dotenv.config({ path: envPath2 });
}
if (!process.env.OPENAI_API_KEY) {
  dotenv.config({ path: envPath3 });
}

export const config = {
  PORT: process.env.PORT || 3001,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.1',
  OPENAI_MAX_TOKENS: parseInt(process.env.OPENAI_MAX_TOKENS || '16000', 10),
  OPENAI_ASSISTANT_ID: process.env.OPENAI_ASSISTANT_ID || '',
  OPENAI_GLOBAL_DAILY_BUDGET_TOKENS: parseInt(process.env.OPENAI_GLOBAL_DAILY_BUDGET_TOKENS || '500000', 10),
  OPENAI_TENANT_DAILY_QUOTA_TOKENS: parseInt(process.env.OPENAI_TENANT_DAILY_QUOTA_TOKENS || '100000', 10),
  OPENAI_MAX_RETRIES: parseInt(process.env.OPENAI_MAX_RETRIES || '3', 10),
  OPENAI_CIRCUIT_BREAK_THRESHOLD: parseInt(process.env.OPENAI_CIRCUIT_BREAK_THRESHOLD || '5', 10),
  OPENAI_CIRCUIT_BREAK_COOLDOWN_MS: parseInt(
    process.env.OPENAI_CIRCUIT_BREAK_COOLDOWN_MS || (5 * 60 * 1000).toString(),
    10
  ),
  OPENAI_CACHE_TTL_MS: parseInt(process.env.OPENAI_CACHE_TTL_MS || (60 * 60 * 1000).toString(), 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  OPENAI_DEFAULT_TENANT_ID: process.env.OPENAI_DEFAULT_TENANT_ID || 'global',
  // Allow multiple comma-separated origins for local dev convenience (3000/3001/3002)
  CORS_ORIGIN: (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001,http://localhost:3002')
    .split(',')
    .map(origin => origin.trim()),
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_FILE_TYPES: ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  // Evaluation scoring weights
  EVALUATION_WEIGHTS: {
    COMPLIANCE: parseFloat(process.env.EVAL_WEIGHT_COMPLIANCE || '0.40'), // 40%
    SECURITY: parseFloat(process.env.EVAL_WEIGHT_SECURITY || '0.30'),    // 30%
    DOCUMENTATION: parseFloat(process.env.EVAL_WEIGHT_DOCS || '0.15'),   // 15%
    TECHNICAL: parseFloat(process.env.EVAL_WEIGHT_TECHNICAL || '0.15'),  // 15%
  },
  // Risk thresholds
  RISK_THRESHOLDS: {
    CRITICAL: parseInt(process.env.RISK_THRESHOLD_CRITICAL || '80', 10),
    HIGH: parseInt(process.env.RISK_THRESHOLD_HIGH || '60', 10),
    MEDIUM: parseInt(process.env.RISK_THRESHOLD_MEDIUM || '40', 10),
  },
};

if (!config.OPENAI_API_KEY) {
  console.warn('⚠️  OPENAI_API_KEY not set. Please configure it in .env file');
}
