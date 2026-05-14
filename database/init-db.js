require('dotenv').config({ path: '../config/.env' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Disable SSL verification for initialization to avoid "self-signed certificate" errors
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function initializeDatabase() {
  console.log('Connecting to remote PostgreSQL database...');
  
  let connectionString = process.env.DATABASE_URL || 
    `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  // If using individual variables and DB_SSL is true, ensure we have a basic SSL connection
  const sslConfig = {
    rejectUnauthorized: false
  };

  const client = new Client({
    connectionString,
    ssl: sslConfig
  });

  try {
    await client.connect();
    console.log('✅ Connected successfully!');

    // Read and execute schema.sql
    console.log('Reading schema.sql...');
    const schemaFile = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaFile)) {
      throw new Error(`Schema file not found at ${schemaFile}`);
    }
    const schemaSql = fs.readFileSync(schemaFile, 'utf8');
    
    await client.query(schemaSql);
    console.log('✅ Schema tables created successfully!');

    // Read and execute seed.sql
    console.log('Reading seed.sql...');
    const seedFile = path.join(__dirname, 'seed.sql');
    if (fs.existsSync(seedFile)) {
      const seedSql = fs.readFileSync(seedFile, 'utf8');
      await client.query(seedSql);
      console.log('✅ Seed data inserted successfully!');
    } else {
      console.log('⚠️ No seed.sql found, skipping seeding.');
    }

    console.log('\n🎉 Database initialization complete!');

  } catch (error) {
    console.error('\n❌ Database initialization failed:');
    console.error(error.message);
    if (error.detail) console.error('Detail:', error.detail);
    if (error.hint) console.error('Hint:', error.hint);
  } finally {
    await client.end();
  }
}

initializeDatabase();
