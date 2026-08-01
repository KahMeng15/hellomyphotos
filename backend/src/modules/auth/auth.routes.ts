import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db';
import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';
import { requireAuth } from '../../utils/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change';
const APP_DOMAIN = process.env.APP_DOMAIN || '';
let cookieDomain: string | undefined = undefined;
if (APP_DOMAIN) {
  try {
    cookieDomain = new URL(APP_DOMAIN).hostname;
  } catch (e) {
    // Ignore invalid URL
  }
}

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
        attempts = 0;
      }

      logger.warn(`Failed login attempt for ${email}`, { ip: request.ip });

      await redis.set(redisKey, JSON.stringify({
        attempts,
        currentPenalty: newPenalty,
        blockedUntil: newBlockedUntil
      }), 'EX', 86400 * 7);

      if (newBlockedUntil > 0) {
        const remainingMinutes = Math.ceil((newBlockedUntil - Date.now()) / 60000);
        return reply.status(429).send({ error: `Too many failed attempts. Please try again in ${remainingMinutes} minute(s).` });
      }
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Login successful, clear penalties
    await redis.del(redisKey);
    logger.info(`User logged in: ${user.email}`, { userId: user.id, ip: request.ip });

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
      domain: cookieDomain,
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
          folders: user.role === 'admin' || user.role === 'super_admin' ? ['*'] : folders,
          mustChangeCredentials: user.email === 'admin@example.com' || user.password_hash === '$2b$10$6RA2zF7AVoZaXO/Wj126ROvtJnVNecG4dvJRW9Sinw1HHUV1SlWYa'
        }
      };
  });

  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.setCookie('token', '', {
      path: '/',
      domain: cookieDomain,
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
      return reply.status(401).send({ error: 'No token found' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      const { rows } = await pool.query('SELECT role, email, name, preferences, password_hash FROM users WHERE id = $1', [decoded.id]);
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
        name: rows[0].name,
        email: rows[0].email,
        role,
        folders,
        preferences: rows[0].preferences || {},
        mustChangeCredentials: rows[0].email === 'admin@example.com' || rows[0].password_hash === '$2b$10$6RA2zF7AVoZaXO/Wj126ROvtJnVNecG4dvJRW9Sinw1HHUV1SlWYa'
      };
      
      return { user: latestUser };
    } catch (error) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });

  fastify.post('/preferences', { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    const preferences = request.body;
    if (typeof preferences !== 'object' || preferences === null) {
      return reply.status(400).send({ error: 'Preferences must be an object' });
    }

    // Merge existing preferences
    const { rows } = await pool.query('SELECT preferences FROM users WHERE id = $1', [user.id]);
    let currentPrefs = {};
    if (rows.length > 0 && rows[0].preferences) {
      currentPrefs = rows[0].preferences;
    }

    const mergedPrefs = { ...currentPrefs, ...preferences };
    await pool.query('UPDATE users SET preferences = $1 WHERE id = $2', [JSON.stringify(mergedPrefs), user.id]);
    return { success: true, preferences: mergedPrefs };
  });

  fastify.put('/profile', { preHandler: requireAuth }, async (request, reply) => {
    const { name, email, currentPassword } = request.body as any;
    if (!name || !email || !currentPassword) {
      return reply.status(400).send({ error: 'Name, email, and current password are required' });
    }

    const { rows: userRows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [request.user!.id]);
    if (userRows.length === 0) return reply.status(404).send({ error: 'User not found' });

    const isValid = await bcrypt.compare(currentPassword, userRows[0].password_hash);
    if (!isValid) {
      return reply.status(400).send({ error: 'Incorrect current password' });
    }
    
    // Check email uniqueness
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, request.user!.id]);
    if (rows.length > 0) {
      return reply.status(400).send({ error: 'Email already exists' });
    }

    await pool.query('UPDATE users SET name = $1, email = $2 WHERE id = $3', [name, email, request.user!.id]);
    
    logger.info(`User ${request.user!.id} updated their profile`);
    return { success: true };
  });

  fastify.put('/password', { preHandler: requireAuth }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body as any;
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'Current and new password are required' });
    }

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [request.user!.id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'User not found' });

    const isValid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!isValid) {
      return reply.status(400).send({ error: 'Incorrect current password' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, request.user!.id]);

    logger.info(`User ${request.user!.id} changed their password`);
    return { success: true };
  });
}
