import bcrypt from 'bcryptjs';
import { pool } from './db.js';

/**
 * seedAdmin - Ensures at least one admin account exists in the database.
 * If no user with the 'admin' role is found, a default one is created.
 */
export async function seedAdmin() {
  try {
    // Check for existing admin users
    const [rows] = await pool.execute('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
    
    if (rows[0].count === 0) {
      console.log('⚠️ No admin account found. Creating a default admin...');
      
      // Default credentials
      const adminUsername = 'admin';
      const adminPassword = 'adminpassword123'; // It is recommended to change this via .env or after first login
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      
      // Insert default admin
      await pool.execute(
        `INSERT INTO users (full_name, phone, email, username, password, role) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          'System Administrator',
          '000-000-0000',
          'admin@example.com',
          adminUsername,
          hashedPassword,
          'admin'
        ]
      );
      
      console.log('✅ Default admin account created successfully.');
      console.log(`   Username: ${adminUsername}`);
      console.log(`   Password: ${adminPassword}`);
      console.log('   ⚠️ WARNING: Please change this password immediately after your first login.');
    } else {
      console.log('ℹ️ Admin account verification: OK (exists)');
    }
  } catch (error) {
    console.error('❌ Error during admin seeding:', error.message);
    // We don't exit the process here to allow the server to still start, 
    // but the error is logged for visibility.
  }
}
