# Backend Quick Reference - PVARA Storage System

## Deployment
- **Production API**: https://backend-aiv2.vercel.app
- **Latest Commit**: e7606a8 (Storage features with rate-limit, email, chat)

## Local Development
```bash
cd /Users/ubl/Desktop/PVARA-Backend
npm install
npm run dev        # Dev server on localhost:3001
npm run build      # TypeScript compile to dist/
npm start          # Production server
```

## API Endpoints

### Storage Routes
```bash
# Create folder
POST /api/storage/folders
Body: {"name": "folder-name"}

# List folders
GET /api/storage/folders

# Delete folder (requires authorization)
DELETE /api/storage/folders
Body: {"folder": "folder-name", "requesterEmail": "user@email.com"}

# Upload files
POST /api/storage/upload
FormData: folder=name, files[]=file1, files[]=file2

# List files
GET /api/storage/files?folder=name

# Delete file (requires authorization)
DELETE /api/storage/files
Body: {"folder": "name", "document": "doc.pdf", "version": 1, "requesterEmail": "user@email.com"}

# List recommendations
GET /api/storage/recommendations?folder=name&document=doc.pdf

# Accept/reject recommendations
POST /api/storage/recommendations/decision
Body: {"folder": "name", "document": "doc.pdf", "version": 1, "acceptIds": [...], "rejectIds": [...]}
```

### Rate Limits
- Authentication: 5 requests / 15 minutes
- File Upload: 10 requests / 1 minute
- General API: 100 requests / 15 minutes

## Test Commands
```bash
# Health check
curl https://backend-aiv2.vercel.app/api/health

# Test folder creation
curl -X POST https://backend-aiv2.vercel.app/api/storage/folders \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key-12345" \
  -d '{"name":"test-folder"}'

# List folders
curl https://backend-aiv2.vercel.app/api/storage/folders \
  -H "x-api-key: dev-key-12345"

# Delete folder
curl -X DELETE https://backend-aiv2.vercel.app/api/storage/folders \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key-12345" \
  -d '{"folder":"test-folder","requesterEmail":"admin@pvara.team"}'
```

## Production Features
- ✅ Rate limiting middleware (separate limits for auth, upload, API)
- ✅ Email service (Nodemailer for invitations)
- ✅ Storage chat service (AI-powered with auto-apply)
- ✅ Access control (folder/file delete requires authorization)
- ✅ MongoDB collections: folders, files, access_grants, storage_chat
- ✅ CORS configured for frontend domains

## Environment Variables (.env)
```
MONGODB_URI=mongodb+srv://...
EMAIL_USER=smtp-email@domain.com
EMAIL_PASS=smtp-password
OPENAI_API_KEY=sk-...
NODE_ENV=production
PORT=3001
```

## Deployment to Vercel
```bash
cd /Users/ubl/Desktop/PVARA-Backend
git add .
git commit -m "feat: your message"
git push origin main    # Auto-deploys to Vercel
```

## Troubleshooting
- Check Vercel logs: https://vercel.com/dashboard
- Verify MongoDB connection string
- Ensure environment variables set in Vercel dashboard
- Check rate limits if requests are being rejected
