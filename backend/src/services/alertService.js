const nodemailer = require("nodemailer");
const { pool } = require("../db/pool");
const redis = require("./redisService");

const COOLDOWN = Number(process.env.ALERT_COOLDOWN_SECONDS) || 30;

let _io = null;
let _transporter = null;

function init(io) {
  _io = io;
  if (process.env.SMTP_HOST) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
}

// In-process cooldown map — used when Redis is unavailable
const _localCooldown = new Map();

async function processViolations(violations) {
  for (const v of violations) {
    const onCooldown = await redis.isAlertOnCooldown(v.zoneId);
    if (onCooldown) continue;

    // Local fallback cooldown so we don't spam when Redis is down
    const localExpiry = _localCooldown.get(v.zoneId) || 0;
    if (Date.now() < localExpiry) continue;
    _localCooldown.set(v.zoneId, Date.now() + COOLDOWN * 1000);

    await redis.setAlertCooldown(v.zoneId, COOLDOWN);

    const alert = {
      zoneId: v.zoneId,
      zoneName: v.zoneName,
      count: v.count,
      limit: v.limit,
      timestamp: new Date().toISOString(),
    };

    // Persist
    await pool.query(
      "INSERT INTO alerts (zone_id, zone_name, count, limit_val) VALUES ($1,$2,$3,$4)",
      [v.zoneId, v.zoneName, v.count, v.limit]
    ).catch(() => {});

    // Real-time push
    if (_io) _io.emit("alert", alert);

    // Email (optional)
    if (_transporter && process.env.ALERT_EMAIL_TO) {
      _transporter.sendMail({
        from: process.env.SMTP_USER,
        to: process.env.ALERT_EMAIL_TO,
        subject: `[People Counter] Zone "${v.zoneName}" exceeded capacity`,
        text: `Zone "${v.zoneName}" has ${v.count} people (limit: ${v.limit}) at ${alert.timestamp}`,
      }).catch(() => {});
    }

    console.log(`[ALERT] Zone "${v.zoneName}": ${v.count}/${v.limit}`);
  }
}

async function getRecentAlerts(limit = 50) {
  const { rows } = await pool.query(
    "SELECT * FROM alerts ORDER BY triggered_at DESC LIMIT $1",
    [limit]
  );
  return rows;
}

module.exports = { init, processViolations, getRecentAlerts };
