const express = require("express");
const alertService = require("../services/alertService");
const router = express.Router();

router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const alerts = await alertService.getRecentAlerts(limit);
  res.json(alerts);
});

module.exports = router;
