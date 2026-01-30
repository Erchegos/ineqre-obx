#!/usr/bin/env tsx
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createPassword(name: string, password: string) {
  console.log('='.repeat(70));
  console.log('CREATING RESEARCH PORTAL PASSWORD');
  console.log('='.repeat(70));
  console.log(`\nClient: ${name}`);
  console.log(`Password: ${password}\n`);

  // Hash the password
  const saltRounds = 10;
  const tokenHash = await bcrypt.hash(password, saltRounds);

  console.log('Hashing password...');
  console.log(`✓ Password hashed\n`);

  // Check if token already exists for this client
  const existing = await pool.query(
    'SELECT id, description FROM research_access_tokens WHERE description = $1',
    [name]
  );

  if (existing.rows.length > 0) {
    // Update existing token
    console.log(`Found existing token for "${name}" (ID: ${existing.rows[0].id})`);
    console.log('Updating password...');

    await pool.query(
      `UPDATE research_access_tokens
       SET token_hash = $1,
           is_active = true,
           expires_at = NULL
       WHERE description = $2`,
      [tokenHash, name]
    );

    console.log('✓ Password updated successfully\n');
  } else {
    // Create new token
    console.log(`Creating new token for "${name}"...`);

    await pool.query(
      `INSERT INTO research_access_tokens (token_hash, description, created_by, is_active, created_at)
       VALUES ($1, $2, $3, true, NOW())`,
      [tokenHash, name, 'admin']
    );

    console.log('✓ New token created successfully\n');
  }

  console.log('='.repeat(70));
  console.log('✅ COMPLETE');
  console.log('='.repeat(70));
  console.log(`\nClient "${name}" can now log in with:`);
  console.log(`  Password: ${password}\n`);

  await pool.end();
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: tsx create-research-password.ts <name> <password>');
  console.error('Example: tsx create-research-password.ts "ColinH" "SecurePass123"');
  process.exit(1);
}

const [name, password] = args;
createPassword(name, password);
