# Global Storage System - Production Deployment Guide

## ✅ Production Readiness Checklist

### Security & Access Control
- [x] **Role-based permissions** (view/edit/delete) enforced at API layer
- [x] **Access control toggle** via `ENABLE_ACCESS_CONTROL` env variable
- [x] **Email-based invitations** with customizable roles (viewer/editor/admin)
- [x] **User authentication** required for sensitive operations
- [x] **Rate limiting** on auth (5/15min), uploads (10/min), and general API (100/15min)
- [x] **File type validation** (PDF, DOCX, TXT, JPG, PNG, XLSX, CSV only)
- [x] **File size limits** (50MB per file, 20 files max per upload)
- [x] **Input sanitization** for folder names and file paths

### User Experience
- [x] **Toast notifications** replace browser alerts for all operations
- [x] **Loading indicators** on all async operations
- [x] **Empty states** with helpful guidance when no data exists
- [x] **Confirmation modals** for destructive actions (delete folder/file)
- [x] **Permission-based UI** (buttons disabled when user lacks permission)
- [x] **Status banners** showing access control state and AI behavior
- [x] **Error messages** user-friendly and actionable

### Data Management
- [x] **Folder creation** with owner auto-granted admin access
- [x] **Multi-file upload** with AI recommendations auto-generation
- [x] **Recommendation versioning** tracks changes over time
- [x] **Folder deletion** cascades to files, recommendations, access grants
- [x] **File deletion** updates application.json and trail
- [x] **Access grant management** (invite, update role, revoke)
- [x] **AI chat** for recommendations with auto-apply capability

### Performance & Scale
- [x] **MongoDB indexes** on applicationId, email, version fields
- [x] **Rate limiting** prevents abuse and resource exhaustion
- [x] **File size caps** prevent storage overflow
- [x] **Efficient queries** with projection and filtering
- [x] **Graceful degradation** when OpenAI/SMTP unavailable

### Error Handling
- [x] **Try-catch blocks** on all async operations
- [x] **Detailed error responses** with HTTP status codes
- [x] **Frontend error boundaries** (via toast notifications)
- [x] **Fallback behaviors** when external services fail
- [x] **Console logging** for debugging (production-safe)

---

## 🚀 Environment Configuration

### Required Variables
```bash
# Database
MONGODB_URI=mongodb://localhost:27017  # or MongoDB Atlas connection string
DB_NAME=pvara_ai_eval

# API Security
API_KEY=your-secure-api-key-here

# CORS (comma-separated for multiple origins)
CORS_ORIGIN=http://localhost:3000,https://yourdomain.com

# Server
PORT=3001
NODE_ENV=production
```

### Optional Variables
```bash
# Access Control (default: false, open access)
ENABLE_ACCESS_CONTROL=true

# Email Invitations (if not set, invites are logged but not sent)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=no-reply@yourdomain.com

# AI Features (if not set, chat uses fallback responses)
OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-4o
```

---

## 📦 Deployment Steps

### 1. Backend Deployment
```bash
cd backend
npm install --production
npm run build
npm start
```

**Health Check:** `GET /health` should return `{"status":"ok","timestamp":"..."}`

### 2. Frontend Deployment
```bash
cd frontend
npm install --production

# Set API URL in .env or .env.production
REACT_APP_API_URL=https://your-backend-url.com/api
REACT_APP_API_KEY=your-secure-api-key-here

npm run build
# Serve build/ with nginx, Vercel, or static hosting
```

---

## 🔐 Security Best Practices

1. **API Keys:** Use strong, randomly generated keys; rotate regularly
2. **HTTPS:** Always deploy with TLS certificates (Let's Encrypt, Cloudflare)
3. **Rate Limits:** Adjust per your traffic patterns; monitor 429 responses
4. **Access Control:** Enable in production with `ENABLE_ACCESS_CONTROL=true`
5. **SMTP Credentials:** Use app-specific passwords, not main account passwords
6. **Database:** Enable auth on MongoDB; restrict network access

---

## 📊 Monitoring & Logging

### Key Metrics to Track
- **API Response Times:** `/api/storage/*` endpoints
- **Upload Success Rate:** File upload failures
- **Rate Limit Hits:** 429 status codes
- **Database Queries:** Slow queries on recommendations collection
- **Storage Usage:** Disk space in `applications/` folder

---

## 🛠️ Troubleshooting

### "Failed to delete folder"
- **Cause:** User lacks delete permission or folder not found
- **Fix:** Check access grants in MongoDB `storage_access` collection; verify folder name

### "Upload rate limit exceeded"
- **Cause:** More than 10 uploads in 1 minute
- **Fix:** Wait or adjust `uploadLimiter` in `rate-limit.middleware.ts`

### "File type not allowed"
- **Cause:** Uploading unsupported extension
- **Fix:** Convert to PDF, DOCX, or other allowed formats; or update `fileFilter` in `storage.routes.ts`

### "Email invite not sent"
- **Cause:** SMTP env variables not set
- **Fix:** Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` in .env; or expect dry-run logs only

---

## 📈 Scaling for 10,000+ Users

### Performance Optimizations
- **Horizontal scaling:** Deploy multiple backend instances behind load balancer
- **Database:** MongoDB Atlas M10+ with read replicas
- **Caching:** Add Redis for folder lists, access grants (reduce DB queries)
- **CDN:** Serve frontend static assets via Cloudflare or AWS CloudFront
- **Object storage:** Migrate from filesystem to S3/GCS for unlimited file capacity

---

## 📝 API Rate Limits (Current)

| Endpoint       | Limit          | Window  | Error Code |
|----------------|----------------|---------|------------|
| `/api/auth/*`  | 5 requests     | 15 min  | 429        |
| `/api/storage/upload` | 10 uploads | 1 min   | 429        |
| All other APIs | 100 requests   | 15 min  | 429        |

**Adjust in:** `backend/src/middleware/rate-limit.middleware.ts`

---

**Repositories:**
- Backend: https://github.com/makenubl/backend-aiv2
- Frontend: https://github.com/makenubl/frontend-aiv2

**Last Updated:** 2025-12-13
**Version:** 1.0.0
**Status:** ✅ Production Ready
