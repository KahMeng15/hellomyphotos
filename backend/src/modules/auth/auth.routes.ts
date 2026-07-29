import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db';
import { redis } from '../../config/redis';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as any;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }

    const ip = request.ip || (request.headers['x-forwarded-for'] as string) || request.socket.remoteAddress || 'unknown';
    const redisKey = `login_attempts:${ip}`;

    // Read settings from DB
    const { rows: settingsRows } = await pool.query(`SELECT key, value FROM admin_settings WHERE key IN ('auth_max_login_tries', 'auth_timeout_minutes', 'auth_double_timeout')`);
    let maxTries = 5;
    let timeoutMinutes = 15;
    let doubleTimeout = true;
    for (const r of settingsRows) {
      if (r.key === 'auth_max_login_tries') maxTries = Number(r.value) || 5;
      if (r.key === 'auth_timeout_minutes') timeoutMinutes = Number(r.value) || 15;
      if (r.key === 'auth_double_timeout') doubleTimeout = typeof r.value === 'string' ? r.value === 'true' : Boolean(r.value);
    }

    const attemptsData = await redis.get(redisKey);
    let attempts = 0;
    let currentPenalty = timeoutMinutes * 60; // in seconds
    let blockedUntil = 0;

    if (attemptsData) {
      const parsed = JSON.parse(attemptsData);
      attempts = parsed.attempts || 0;
      currentPenalty = parsed.currentPenalty || (timeoutMinutes * 60);
      blockedUntil = parsed.blockedUntil || 0;

      if (Date.now() < blockedUntil) {
        const remainingMinutes = Math.ceil((blockedUntil - Date.now()) / 60000);
        return reply.status(429).send({ error: `Too many failed attempts. Please try again in ${remainingMinutes} minute(s).` });
      }
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    let isMatch = false;
    let user = null;

    if (rows.length > 0) {
      user = rows[0];
      isMatch = await bcrypt.compare(password, user.password_hash);
    }

    if (!isMatch || !user) {
      attempts += 1;
      let newBlockedUntil = 0;
      let newPenalty = currentPenalty;
      
      if (attempts >= maxTries) {
        newBlockedUntil = Date.now() + (newPenalty * 1000);
        if (doubleTimeout) {
          newPenalty = newPenalty * 2;
        }
        attempts = 0; // Reset attempts to 0 so the next fail triggers the new penalty
      }

      await redis.set(redisKey, JSON.stringify({
        attempts,
        currentPenalty: newPenalty,
        blockedUntil: newBlockedUntil
      }), 'EX', 86400 * 7); // keep state for 7 days

      if (newBlockedUntil > 0) {
        const remainingMinutes = Math.ceil((newBlockedUntil - Date.now()) / 60000);
        return reply.status(429).send({ error: `Too many failed attempts. Please try again in ${remainingMinutes} minute(s).` });
      }
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Login successful, clear penalties
    await redis.del(redisKey);

    // Determine folder access for non-admins
    let folders: string[] = [];
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      const accessRows = await pool.query('SELECT folder_path FROM user_folder_access WHERE user_id = $1', [user.id]);
      folders = accessRows.rows.map(r => r.folder_path);
    }

    const token = jwt.sign({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
        folders: user.role === 'admin' || user.role === 'super_admin' ? ['*'] : folders
    }, JWT_SECRET, { expiresIn: '7d' });

    // Set cookie
    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 // 7 days
    });

    return { 
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      folders: user.role === 'admin' || user.role === 'super_admin' ? ['*'] : folders
      }
    };
  });

  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.setCookie('token', '', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0 // Expire immediately
    });
    return { success: true };
  });

  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.token;
    if (!token) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.id]);
      if (rows.length === 0) {
        return reply.status(401).send({ error: 'User not found' });
      }
      
      const role = rows[0].role;
      let folders: string[] = [];
      
      if (role === 'admin' || role === 'super_admin') {
        folders = ['*'];
      } else {
        const accessRows = await pool.query('SELECT folder_path FROM user_folder_access WHERE user_id = $1', [decoded.id]);
        folders = accessRows.rows.map(r => r.folder_path);
      }
      
      const latestUser = {
        ...decoded,
        role,
        folders
      };
      
      return { user: latestUser };
    } catch (error) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });
}
