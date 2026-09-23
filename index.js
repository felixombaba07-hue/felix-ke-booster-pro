require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const { query, getClient } = require("./db");
const { signUser, authRequired, adminRequired } = require("./middleware/auth");
const paystack = require("./paystack");
const provider = require("./provider");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = (process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
    cb(null, allowed.length === 0 || allowed.includes(origin));
  }
}));
app.use(express.json({ limit: "200kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

function cleanString(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function uuid() { return crypto.randomUUID(); }

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true, service: "FELIX KE BOOSTER PRO", database: "ok" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    brand: "FELIX KE BOOSTER PRO",
    currency: "KES",
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || null
  });
});

app.post("/api/auth/register", async (req, res) => {
  const fullName = cleanString(req.body.fullName, 120);
  const email = cleanString(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || "");

  if (!fullName || !validEmail(email) || password.length < 8) {
    return res.status(400).json({ error: "Enter a name, valid email and password of at least 8 characters." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuid();
    await query(
      "INSERT INTO users (id,email,password_hash,full_name) VALUES ($1,$2,$3,$4)",
      [userId, email, passwordHash, fullName]
    );
    await query("INSERT INTO wallets (user_id) VALUES ($1)", [userId]);
    const user = { id: userId, email, fullName, role: "customer" };
    res.status(201).json({ token: signUser(user), user });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Email already registered." });
    console.error(err);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = cleanString(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || "");

  const result = await query("SELECT id,email,password_hash,full_name,role FROM users WHERE email=$1", [email]);
  if (!result.rows[0] || !(await bcrypt.compare(password, result.rows[0].password_hash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const u = result.rows[0];
  const user = { id: u.id, email: u.email, fullName: u.full_name, role: u.role };
  res.json({ token: signUser(user), user });
});

app.get("/api/me", authRequired, async (req, res) => {
  const user = await query(
    `SELECT u.id,u.email,u.full_name,u.role,COALESCE(w.balance,0) balance
     FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id=$1`,
    [req.user.sub]
  );
  if (!user.rows[0]) return res.status(404).json({ error: "User not found" });
  res.json(user.rows[0]);
});

app.get("/api/services", async (req, res) => {
  const platform = cleanString(req.query.platform, 40);
  const search = cleanString(req.query.search, 100);
  const params = [];
  const where = ["s.enabled=true"];

  if (platform) { params.push(platform); where.push(`s.platform=$${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(LOWER(s.name) LIKE LOWER($${params.length}) OR LOWER(s.description) LIKE LOWER($${params.length}))`);
  }

  const r = await query(
    `SELECT s.id,s.platform,s.name,s.description,s.price_per_1000,s.min_quantity,s.max_quantity,
            s.delivery_estimate,s.refill_policy
     FROM services s WHERE ${where.join(" AND ")}
     ORDER BY s.platform,s.name`,
    params
  );
  res.json(r.rows);
});

app.get("/api/wallet", authRequired, async (req, res) => {
  const wallet = await query("SELECT balance FROM wallets WHERE user_id=$1", [req.user.sub]);
  const tx = await query(
    `SELECT type,amount,reference,description,created_at
     FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [req.user.sub]
  );
  res.json({ balance: Number(wallet.rows[0]?.balance || 0), transactions: tx.rows });
});

app.post("/api/payments/paystack/initialize", authRequired, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 50 || amount > 1000000) {
    return res.status(400).json({ error: "Enter a valid amount between KSh 50 and KSh 1,000,000." });
  }

  const user = await query("SELECT email FROM users WHERE id=$1", [req.user.sub]);
  const reference = `FKBP-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  await query(
    `INSERT INTO payment_transactions (id,user_id,provider,reference,amount,status)
     VALUES ($1,$2,'paystack',$3,$4,'pending')`,
    [uuid(), req.user.sub, reference, amount]
  );

  try {
    const result = await paystack.initialize({
      email: user.rows[0].email,
      amount,
      reference,
      callback_url: process.env.PAYSTACK_CALLBACK_URL || `${process.env.APP_URL}/api/payments/paystack/callback`
    });
    res.json({ authorizationUrl: result.data.authorization_url, reference });
  } catch (err) {
    await query("UPDATE payment_transactions SET status='failed' WHERE reference=$1", [reference]);
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/payments/paystack/callback", async (req, res) => {
  const reference = cleanString(req.query.reference, 120);
  if (!reference) return res.status(400).send("Missing payment reference.");

  try {
    const verified = await paystack.verify(reference);
    const data = verified.data;
    if (data.status !== "success") return res.status(400).send("Payment was not successful.");

    const client = await getClient();
    try {
      await client.query("BEGIN");
      const payment = await client.query(
        "SELECT * FROM payment_transactions WHERE reference=$1 FOR UPDATE",
        [reference]
      );
      if (!payment.rows[0]) throw new Error("Payment reference not found.");

      if (payment.rows[0].status !== "success") {
        const amount = Number(payment.rows[0].amount);
        await client.query(
          `UPDATE payment_transactions SET status='success',raw_response=$1,verified_at=NOW() WHERE reference=$2`,
          [JSON.stringify(data), reference]
        );
        await client.query(
          `INSERT INTO wallets (user_id,balance) VALUES ($1,0)
           ON CONFLICT (user_id) DO NOTHING`,
          [payment.rows[0].user_id]
        );
        await client.query(
          "UPDATE wallets SET balance=balance+$1,updated_at=NOW() WHERE user_id=$2",
          [amount, payment.rows[0].user_id]
        );
        await client.query(
          `INSERT INTO wallet_transactions (id,user_id,type,amount,reference,description)
           VALUES ($1,$2,'credit',$3,$4,'Verified Paystack wallet deposit')`,
          [uuid(), payment.rows[0].user_id, amount, `deposit-${reference}`]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.redirect(`${process.env.APP_URL || ""}/?payment=success`);
  } catch (err) {
    console.error(err);
    res.status(400).send("Payment verification failed.");
  }
});

app.get("/api/orders", authRequired, async (req, res) => {
  const r = await query(
    `SELECT o.id,o.target,o.quantity,o.total,o.status,o.provider_order_id,o.provider_status,o.created_at,
            s.platform,s.name service_name
     FROM orders o JOIN services s ON s.id=o.service_id
     WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 100`,
    [req.user.sub]
  );
  res.json(r.rows);
});

app.post("/api/orders", authRequired, async (req, res) => {
  const serviceId = cleanString(req.body.serviceId, 80);
  const target = cleanString(req.body.target, 500);
  const quantity = Number(req.body.quantity);
  const idem = cleanString(req.headers["idempotency-key"] || req.body.idempotencyKey, 120) || uuid();

  if (!serviceId || !target || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Service, public target and valid quantity are required." });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const existing = await client.query("SELECT * FROM orders WHERE idempotency_key=$1", [idem]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return res.json(existing.rows[0]);
    }

    const service = await client.query(
      "SELECT * FROM services WHERE id=$1 AND enabled=true FOR UPDATE",
      [serviceId]
    );
    if (!service.rows[0]) throw new Error("Service unavailable.");

    const s = service.rows[0];
    if (quantity < s.min_quantity || quantity > s.max_quantity) {
      throw new Error(`Quantity must be between ${s.min_quantity} and ${s.max_quantity}.`);
    }

    const total = Math.round((quantity / 1000) * Number(s.price_per_1000) * 100) / 100;
    const wallet = await client.query("SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE", [req.user.sub]);
    const balance = Number(wallet.rows[0]?.balance || 0);

    if (balance < total) throw new Error("Insufficient wallet balance. Deposit funds first.");

    const orderId = uuid();
    await client.query(
      `UPDATE wallets SET balance=balance-$1,updated_at=NOW() WHERE user_id=$2`,
      [total, req.user.sub]
    );
    await client.query(
      `INSERT INTO wallet_transactions (id,user_id,type,amount,reference,description)
       VALUES ($1,$2,'debit',$3,$4,$5)`,
      [uuid(), req.user.sub, total, `order-${orderId}`, `Order ${orderId}`]
    );
    await client.query(
      `INSERT INTO orders
       (id,user_id,service_id,target,quantity,unit_price,total,status,idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'processing',$8)`,
      [orderId, req.user.sub, serviceId, target, quantity, s.price_per_1000, total, idem]
    );

    await client.query("COMMIT");

    // Provider call occurs after the wallet transaction commits.
    // If provider creation fails, refund the wallet and mark the order failed.
    if (!s.provider_service_id || s.mock_provider) {
      await query(
        "UPDATE orders SET status='pending_provider',error_message=$1,updated_at=NOW() WHERE id=$2",
        ["Provider service mapping is not configured yet.", orderId]
      );
      return res.status(202).json({
        id: orderId,
        status: "pending_provider",
        message: "Order created. Provider mapping is not configured yet."
      });
    }

    try {
      const providerResult = await provider.createOrder({
        service: s.provider_service_id,
        link: target,
        quantity
      });
      const providerId = providerResult.order || providerResult.id;
      if (!providerId) throw new Error("Provider did not return an order ID.");

      await query(
        "UPDATE orders SET status='submitted',provider_order_id=$1,provider_status=$2,updated_at=NOW() WHERE id=$3",
        [String(providerId), "submitted", orderId]
      );
      res.status(201).json({ id: orderId, status: "submitted", providerOrderId: providerId });
    } catch (err) {
      const refundClient = await getClient();
      try {
        await refundClient.query("BEGIN");
        await refundClient.query(
          "UPDATE wallets SET balance=balance+$1,updated_at=NOW() WHERE user_id=$2",
          [total, req.user.sub]
        );
        await refundClient.query(
          `INSERT INTO wallet_transactions (id,user_id,type,amount,reference,description)
           VALUES ($1,$2,'refund',$3,$4,$5)`,
          [uuid(), req.user.sub, total, `refund-${orderId}`, `Automatic refund for failed provider submission ${orderId}`]
        );
        await refundClient.query(
          "UPDATE orders SET status='failed',error_message=$1,updated_at=NOW() WHERE id=$2",
          [err.message, orderId]
        );
        await refundClient.query("COMMIT");
      } catch (refundErr) {
        await refundClient.query("ROLLBACK");
        console.error("Refund failure", refundErr);
      } finally {
        refundClient.release();
      }
      return res.status(502).json({ error: "Provider order failed; the wallet has been queued for refund.", orderId });
    }
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    res.status(400).json({ error: err.message || "Order failed." });
  } finally {
    client.release();
  }
});

app.get("/api/provider/balance", authRequired, adminRequired, async (_req, res) => {
  try { res.json(await provider.getBalance()); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

app.get("/api/provider/services", authRequired, adminRequired, async (_req, res) => {
  try { res.json(await provider.getServices()); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

app.post("/api/admin/services/:id", authRequired, adminRequired, async (req, res) => {
  const id = req.params.id;
  const allowed = ["price_per_1000","min_quantity","max_quantity","delivery_estimate","refill_policy","provider_service_id","enabled","mock_provider"];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      values.push(req.body[key]);
      updates.push(`${key}=$${values.length}`);
    }
  }
  if (!updates.length) return res.status(400).json({ error: "No editable fields supplied." });
  values.push(id);
  const r = await query(
    `UPDATE services SET ${updates.join(",")},updated_at=NOW() WHERE id=$${values.length} RETURNING *`,
    values
  );
  if (!r.rows[0]) return res.status(404).json({ error: "Service not found." });
  res.json(r.rows[0]);
});

app.post("/api/support/tickets", authRequired, async (req, res) => {
  const subject = cleanString(req.body.subject, 160);
  const message = cleanString(req.body.message, 2000);
  if (!subject || !message) return res.status(400).json({ error: "Subject and message are required." });

  const r = await query(
    `INSERT INTO support_tickets (id,user_id,subject,message)
     VALUES ($1,$2,$3,$4) RETURNING id,subject,message,status,created_at`,
    [uuid(), req.user.sub, subject, message]
  );
  res.status(201).json(r.rows[0]);
});

app.get("/api/admin/orders", authRequired, adminRequired, async (_req, res) => {
  const r = await query(
    `SELECT o.*,u.email,s.platform,s.name service_name
     FROM orders o JOIN users u ON u.id=o.user_id JOIN services s ON s.id=o.service_id
     ORDER BY o.created_at DESC LIMIT 200`
  );
  res.json(r.rows);
});

app.use(express.static(publicDir));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

app.listen(PORT, () => {
  console.log(`FELIX KE BOOSTER PRO running on port ${PORT}`);
});
