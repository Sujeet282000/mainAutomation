const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function test() {
  const pool = new Pool({ connectionString: 'postgres://algoverge:algoverge@localhost:5432/algoverge' });
  
  try {
    const hash = await bcrypt.hash('TestPass123!', 10);
    
    // Create user
    const user = await pool.query(
      `INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email`,
      ['debug@orchestra.dev', 'Debug User', hash]
    );
    console.log('User created:', user.rows[0]);
    
    // Create org
    const slug = 'debug-org-' + user.rows[0].id.slice(0, 6);
    const org = await pool.query(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      ['Debug Org', slug]
    );
    console.log('Org created:', org.rows[0]);
    
    // Add membership
    await pool.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [org.rows[0].id, user.rows[0].id]
    );
    console.log('Membership created');
    
    // Create project
    const project = await pool.query(
      `INSERT INTO projects (org_id, name, slug) VALUES ($1, 'Main', 'main') RETURNING id`,
      [org.rows[0].id]
    );
    console.log('Project created:', project.rows[0]);
    
    console.log('SUCCESS');
  } catch (err) {
    console.error('ERROR:', err.message, err.detail);
  } finally {
    await pool.end();
  }
}

test();
