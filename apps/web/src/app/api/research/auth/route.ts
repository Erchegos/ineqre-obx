import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { sign } from 'jsonwebtoken';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    if (!password) {
      return NextResponse.json(
        { error: 'Password required' },
        { status: 400 }
      );
    }

    // Get active tokens from database
    const result = await pool.query(
      `SELECT id, token_hash
       FROM research_access_tokens
       WHERE is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())`
    );

    // Check password against all active tokens
    for (const row of result.rows) {
      const isValid = await bcrypt.compare(password, row.token_hash);
      if (isValid) {
        // Update last_used_at
        await pool.query(
          'UPDATE research_access_tokens SET last_used_at = NOW() WHERE id = $1',
          [row.id]
        );

        // Generate JWT token for session
        const token = sign(
          { tokenId: row.id },
          process.env.JWT_SECRET || 'your-secret-key-change-this',
          { expiresIn: '24h' }
        );

        return NextResponse.json({ token });
      }
    }

    // No matching token found
    return NextResponse.json(
      { error: 'Invalid password' },
      { status: 401 }
    );
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
