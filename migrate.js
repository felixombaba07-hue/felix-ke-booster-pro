const fs = require("fs");
const path = require("path");
const { query, pool } = require("../db");

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
    await query(sql);
    console.log("Database migration complete.");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
