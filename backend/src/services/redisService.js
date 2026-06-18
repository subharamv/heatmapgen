const Redis = require("ioredis");

let redisAvailable = false;

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  lazyConnect: true,
  retryStrategy: () => null,
  reconnectOnError: () => false,
});

redis.on("error", () => {});

async function connect() {
  try {
    await redis.connect();
    redisAvailable = true;
    console.log("[Redis] Connected");
  } catch (e) {
    console.warn("[Redis] Could not connect — running without cache");
  }
}

async function getZoneCounts() {
  try {
    const raw = await redis.get("zone_counts");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function setZoneCounts(counts) {
  try {
    await redis.set("zone_counts", JSON.stringify(counts), "EX", 10);
  } catch {}
}

async function isAlertOnCooldown(zoneId) {
  try {
    return !!(await redis.get(`alert_cd:${zoneId}`));
  } catch {
    return false;
  }
}

async function setAlertCooldown(zoneId, seconds) {
  try {
    await redis.set(`alert_cd:${zoneId}`, "1", "EX", seconds);
  } catch {}
}

module.exports = { connect, getZoneCounts, setZoneCounts, isAlertOnCooldown, setAlertCooldown };
