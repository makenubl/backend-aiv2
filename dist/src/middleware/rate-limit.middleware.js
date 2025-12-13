"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authLimiter = exports.uploadLimiter = exports.apiLimiter = void 0;
exports.rateLimit = rateLimit;
const store = {};
function rateLimit(options) {
    const { windowMs, max, message = 'Too many requests, please try again later', keyGenerator = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown' } = options;
    return (req, res, next) => {
        const key = keyGenerator(req);
        const now = Date.now();
        // Clean up expired entries periodically
        if (Math.random() < 0.01) {
            Object.keys(store).forEach(k => {
                if (store[k].resetTime < now) {
                    delete store[k];
                }
            });
        }
        if (!store[key] || store[key].resetTime < now) {
            store[key] = {
                count: 1,
                resetTime: now + windowMs
            };
            return next();
        }
        store[key].count++;
        if (store[key].count > max) {
            return res.status(429).json({
                error: message,
                retryAfter: Math.ceil((store[key].resetTime - now) / 1000)
            });
        }
        next();
    };
}
// Preset rate limiters
exports.apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes
    message: 'Too many requests from this IP, please try again later'
});
exports.uploadLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 uploads per minute
    message: 'Upload rate limit exceeded. Please wait before uploading more files'
});
exports.authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per 15 minutes
    message: 'Too many login attempts. Please try again later'
});
//# sourceMappingURL=rate-limit.middleware.js.map