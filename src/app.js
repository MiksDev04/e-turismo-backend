import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import errorHandler from './middleware/errorHandler.js';
import verifyApiKey from './middleware/apiKey.js';
import registerRoutes from './routes/register.api.js';
import loginRoutes from './routes/login.api.js';
import profileRoutes from './routes/profile.api.js';
import accommodationRoutes from './routes/accommodation.api.js';
import guestEntryRoutes from './routes/guest_entry.api.js';
import guestRecordsRoutes from './routes/guest_records.api.js';
import dashboardRoutes from './routes/dashboard.api.js';
import messageRoutes from './routes/messages.api.js';
import complianceRoutes from './routes/compliance.api.js';
import reportRoutes from './routes/reports.api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(verifyApiKey); // Protect all subsequent API routes with API Key

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth', registerRoutes);
app.use('/api/auth', loginRoutes);
app.use('/api', profileRoutes);
app.use('/api/admin/accommodations', accommodationRoutes);
app.use('/api/admin/compliance', complianceRoutes);
app.use('/api/admin', reportRoutes);
app.use('/api/business', guestEntryRoutes);
app.use('/api/business', guestRecordsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/messages', messageRoutes);

// ── Error handler (must be last) ──────────────────────────────
app.use(errorHandler);

export default app;