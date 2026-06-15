import dotenv from 'dotenv';
import app from './src/app.js';
import { testConnection } from './src/config/db.js';
import { seedAdmin } from './src/config/seeder.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

async function start() {
  await testConnection();
  await seedAdmin();
  app.listen(PORT, () => {
    console.log(`🚀 Tourism API running on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV}`);
  });
}

start();