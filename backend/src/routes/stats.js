const express = require("express");
const { pool } = require("../db/pool");
const router = express.Router();

// Last N count records for charting
router.get("/counts", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { rows } = await pool.query(
    "SELECT recorded_at, total_count, zone_counts FROM people_counts ORDER BY recorded_at DESC LIMIT $1",
    [limit]
  );
  res.json(rows.reverse());
});

// Summary: peak count per zone in last hour
router.get("/summary", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      zone_counts,
      total_count,
      recorded_at
    FROM people_counts
    WHERE recorded_at > NOW() - INTERVAL '1 hour'
    ORDER BY recorded_at DESC
    LIMIT 1
  `);
  res.json(rows[0] || { total_count: 0, zone_counts: {} });
});

module.exports = router;
