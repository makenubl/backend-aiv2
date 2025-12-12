"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_service_1 = require("../services/database.service");
const router = (0, express_1.Router)();
// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required'
            });
        }
        const user = await (0, database_service_1.findUserByUsername)(username);
        if (!user || user.password !== password) {
            console.log(`Login failed for username: ${username}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }
        console.log(`Login successful for username: ${username}`);
        // Return user info on successful login (without password)
        const { password: _, ...userWithoutPassword } = user;
        return res.status(200).json({
            success: true,
            user: userWithoutPassword,
            message: 'Login successful'
        });
    }
    catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
});
// Verify token endpoint (optional, for future JWT implementation)
router.post('/verify', (_req, res) => {
    try {
        return res.status(200).json({
            success: true,
            message: 'Token is valid'
        });
    }
    catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map