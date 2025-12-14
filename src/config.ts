import dotenv from 'dotenv';
import path from 'path';

// When running from dist/src/, we need to go up two levels to find .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  PORT: process.env.PORT || 3001,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.1',
  OPENAI_MAX_TOKENS: parseInt(process.env.OPENAI_MAX_TOKENS || '16000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
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
