import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: process.env.API_ENV_FILE ?? '.env' });

const email = process.env.OWNER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.OWNER_ADMIN_PASSWORD;
const fullName = process.env.OWNER_ADMIN_NAME?.trim() || 'Loyiha egasi';
if (!process.env.DATABASE_URL || !email || !password || password.length < 12) {
  throw new Error('DATABASE_URL, OWNER_ADMIN_EMAIL va kamida 12 belgili OWNER_ADMIN_PASSWORD majburiy.');
}
const ownerPassword: string = password;
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
async function seedOwnerAdmin() {
  const hash = await bcrypt.hash(ownerPassword, 12);
  const user = await db.query(`INSERT INTO users (full_name,email,password_hash,is_active,is_anonymous) VALUES ($1,$2,$3,true,false) ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name,password_hash=EXCLUDED.password_hash,is_active=true RETURNING id`, [fullName,email,hash]);
  await db.query(`INSERT INTO user_roles (user_id,role_id) SELECT $1,id FROM roles WHERE code='admin' ON CONFLICT DO NOTHING`, [user.rows[0].id]);
  console.log(`Owner admin tayyor: ${email}`);
  await db.end();
}

void seedOwnerAdmin().catch(async (error: unknown) => {
  await db.end();
  console.error(error);
  process.exitCode = 1;
});
