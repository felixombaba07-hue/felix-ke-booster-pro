const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { query, pool } = require("../db");

const id = () => crypto.randomUUID();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "change-this";

  const adminId = id();
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await query(
    `INSERT INTO users (id,email,password_hash,full_name,role)
     VALUES ($1,$2,$3,$4,'admin')
     ON CONFLICT (email) DO NOTHING`,
    [adminId, adminEmail, passwordHash, "FELIX KE BOOSTER PRO Admin"]
  );

  const categoryNames = [
    ["Facebook", "facebook"],
    ["Instagram", "instagram"],
    ["TikTok", "tiktok"],
    ["YouTube", "youtube"],
    ["X", "x"],
    ["Telegram", "telegram"],
    ["WhatsApp", "whatsapp"]
  ];

  const categoryIds = {};
  for (const [name, slug] of categoryNames) {
    const r = await query(
      `INSERT INTO categories (id,name,slug) VALUES ($1,$2,$3)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [id(), name, slug]
    );
    categoryIds[slug] = r.rows[0].id;
  }

  const services = [
    ["facebook","Facebook Followers","Facebook follower service. Use only with a public target.",150,100,100000,"Varies","Provider dependent"],
    ["facebook","Facebook Likes","Facebook likes for a public target.",100,100,100000,"Varies","Provider dependent"],
    ["instagram","Instagram Followers","Instagram followers for a public target.",350,100,100000,"Varies","Provider dependent"],
    ["instagram","Instagram Likes","Instagram likes for a public target.",150,100,100000,"Varies","Provider dependent"],
    ["tiktok","TikTok Followers","TikTok followers for a public target.",500,100,100000,"Varies","Provider dependent"],
    ["tiktok","TikTok Likes","TikTok likes for a public target.",80,100,100000,"Varies","Provider dependent"],
    ["youtube","YouTube Subscribers","YouTube subscribers for a public channel.",700,100,100000,"Varies","Provider dependent"],
    ["telegram","Telegram Members","Telegram member service for eligible public communities.",300,100,100000,"Varies","Provider dependent"]
  ];

  for (const s of services) {
    await query(
      `INSERT INTO services
       (id,category_id,platform,name,description,price_per_1000,min_quantity,max_quantity,delivery_estimate,refill_policy,enabled,mock_provider)
       SELECT $1,c.id,$2,$3,$4,$5,$6,$7,$8,$9,true,true
       FROM categories c WHERE c.slug=$2
       AND NOT EXISTS (SELECT 1 FROM services WHERE platform=$2 AND name=$3)`,
      [id(), s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]]
    );
  }

  console.log("Seed complete.");
  console.log(`Admin email: ${adminEmail}`);
  console.log("Change the admin password before production use.");
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
