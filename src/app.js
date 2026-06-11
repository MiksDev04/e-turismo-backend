import express from 'express';
import cors from 'cors';
import path from 'path';
import errorHandler from './middleware/errorHandler.js';

// const authRoutes          = require('./routes/auth.routes');
// const businessRoutes      = require('./routes/business.routes');
// const guestRoutes         = require('./routes/guest.routes');
// const adminRoutes         = require('./routes/admin.routes');
// const messagesRoutes      = require('./routes/messages.routes');
// const reportsRoutes       = require('./routes/reports.routes');

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Routes ────────────────────────────────────────────────────
// app.use('/api/auth',      authRoutes);
// app.use('/api/business',  businessRoutes);
// app.use('/api/guest',     guestRoutes);
// app.use('/api/admin',     adminRoutes);
// app.use('/api/messages',  messagesRoutes);
// app.use('/api/reports',   reportsRoutes);

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Error handler (must be last) ──────────────────────────────
app.use(errorHandler);

module.exports = app;