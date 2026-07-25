const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'hellomyphotos',
  password: 'hellomyphotos_secret',
  database: 'hellomyphotos'
});

async function run() {
  const email = process.argv[2] || 'admin@example.com';
  const password = process.argv[3] || 'admin';
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await pool.query(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Admin', $2, 'admin') ON CONFLICT (email) DO NOTHING`,
      [email, passwordHash]
    );
    console.log(`Admin user ${email} created with password ${password}`);
  } catch (err) {
    console.error('Error creating admin user:', err);
  } finally {
    process.exit(0);
  }
}
run();
