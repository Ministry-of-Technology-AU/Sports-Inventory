#!/usr/bin/env node
// test-db-connection.js - Diagnose Railway MySQL connection issues

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

console.log("🔍 Railway MySQL Connection Diagnostic Tool\n");

const config = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
};

console.log("📋 Configuration:");
console.log(`   Host: ${config.host}`);
console.log(`   Port: ${config.port}`);
console.log(`   User: ${config.user}`);
console.log(`   Database: ${config.database}`);
console.log(`   Password: ${config.password ? '✓ Set' : '✗ Not set'}\n`);

// Test different SSL configurations
const sslConfigs = [
  { name: "SSL with TLSv1.2-1.3 + self-signed cert", ssl: { rejectUnauthorized: false, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' } },
  { name: "SSL with TLSv1.2 (minVersion)", ssl: { rejectUnauthorized: false, minVersion: 'TLSv1.2' } },
  { name: "SSL with rejectUnauthorized: false", ssl: { rejectUnauthorized: false } },
  { name: "SSL disabled", ssl: false },
  { name: "Default (no SSL config)", ssl: undefined }
];

async function testConnection(sslConfig) {
  const testConfig = {
    ...config,
    connectTimeout: 10000,
    ...(sslConfig.ssl !== undefined && { ssl: sslConfig.ssl })
  };

  console.log(`⏳ Testing: ${sslConfig.name}...`);
  
  try {
    const connection = await mysql.createConnection(testConfig);
    const [rows] = await connection.query('SELECT 1 as test, VERSION() as mysql_version');
    await connection.end();
    
    console.log(`   ✅ SUCCESS! MySQL Version: ${rows[0].mysql_version}`);
    console.log(`   ✅ This configuration works!\n`);
    return true;
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.code || err.message}`);
    if (err.code === 'ETIMEDOUT') {
      console.log(`   💡 This is a timeout - Railway service may be paused`);
    } else if (err.code === 'ECONNREFUSED') {
      console.log(`   💡 Connection refused - check host and port`);
    } else if (err.message.includes('SSL')) {
      console.log(`   💡 SSL error - try a different SSL configuration`);
    }
    console.log();
    return false;
  }
}

async function main() {
  console.log("🚀 Starting connection tests...\n");
  
  let successCount = 0;
  
  for (const sslConfig of sslConfigs) {
    const success = await testConnection(sslConfig);
    if (success) successCount++;
  }
  
  console.log("═".repeat(60));
  console.log(`\n📊 Results: ${successCount}/${sslConfigs.length} configurations succeeded\n`);
  
  if (successCount === 0) {
    console.log("❌ All connection attempts failed!\n");
    console.log("Possible causes:");
    console.log("  1. Railway MySQL service is PAUSED");
    console.log("     → Visit https://railway.app/dashboard to resume it");
    console.log("  2. Wrong credentials in .env file");
    console.log("     → Check Railway dashboard for current credentials");
    console.log("  3. Network/firewall issues");
    console.log("     → Try from a different network");
    console.log("  4. Railway service is down");
    console.log("     → Check https://status.railway.app/\n");
    console.log("📖 See RAILWAY_TROUBLESHOOTING.md for detailed help");
  } else {
    console.log("✅ At least one configuration works!");
    console.log("📝 Update your app configuration to use the working SSL settings.\n");
  }
}

main().catch(err => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
