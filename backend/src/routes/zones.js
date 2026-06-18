const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../db/pool");
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM zones ORDER BY created_at");
    res.json(rows.map(dbToZone));
  } catch (err) {
    console.error("[zones] GET error:", err.message);
    res.status(503).json({ error: "Database unavailable" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, polygon, maxCapacity = 10 } = req.body;
    if (!name || !polygon || polygon.length < 3)
      return res.status(400).json({ error: "name and polygon (min 3 points) required" });

    const id = uuidv4();
    const { rows } = await pool.query(
      "INSERT INTO zones (id, name, polygon, max_capacity) VALUES ($1,$2,$3,$4) RETURNING *",
      [id, name, JSON.stringify(polygon), maxCapacity]
    );
    res.status(201).json(dbToZone(rows[0]));
  } catch (err) {
    console.error("[zones] POST error:", err.message);
    res.status(503).json({ error: "Database unavailable" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, polygon, maxCapacity } = req.body;
    const { rows } = await pool.query(
      `UPDATE zones SET name=COALESCE($1,name), polygon=COALESCE($2,polygon),
       max_capacity=COALESCE($3,max_capacity), updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [name, polygon ? JSON.stringify(polygon) : null, maxCapacity, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Zone not found" });
    res.json(dbToZone(rows[0]));
  } catch (err) {
    console.error("[zones] PUT error:", err.message);
    res.status(503).json({ error: "Database unavailable" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM zones WHERE id=$1", [req.params.id]);
    res.json({ status: "deleted" });
  } catch (err) {
    console.error("[zones] DELETE error:", err.message);
    res.status(503).json({ error: "Database unavailable" });
  }
});

function dbToZone(row) {
  return {
    id: row.id,
    name: row.name,
    polygon: row.polygon,
    maxCapacity: row.max_capacity,
    createdAt: row.created_at,
  };
}

module.exports = router;
