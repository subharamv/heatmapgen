const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER || "peoplecounter",
  password: process.env.PG_PASSWORD || "peoplecounter123",
  database: process.env.PG_DATABASE || "peoplecounter",
});

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("[DB] Schema ready");
}

module.exports = { pool, initSchema };
