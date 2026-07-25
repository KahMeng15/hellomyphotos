import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../config/db';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_please_change';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, password } = request.body as any;

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.length === 0) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!isMatch) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Determine folder access for non-admins
    let folders: string[] = [];
    if (user.role !== 'admin') {
      const accessRows = await pool.query('SELECT folder_path FROM user_folder_access WHERE user_id = $1', [user.id]);
      folders = accessRows.rows.map(r => r.folder_path);
    }

    const token = jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      folders: user.role === 'admin' ? ['*'] : folders
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
        role: user.role,
        folders: user.role === 'admin' ? ['*'] : folders
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
      return { user: decoded };
    } catch (error) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });
}
