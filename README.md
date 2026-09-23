# FELIX KE BOOSTER PRO

A deployable Kenyan digital-marketing/SMM reseller starter platform.

## Included

- Mobile-first landing page and service catalogue
- Platform/search filtering
- Public target URL/username ordering only
- Customer registration/login
- Customer dashboard, wallet and orders
- Paystack payment initialization + server-side verification
- Wallet credit after verified payment only
- SMM API abstraction compatible with common v3 reseller APIs
- Provider service sync, balance check, order creation and status checks
- Admin dashboard APIs for services and orders
- PostgreSQL schema/migrations
- Helmet, rate limiting, validation and JWT authentication
- Docker deployment

## Important

Never put secret keys in frontend code. Do not ask customers for social-media passwords, 2FA codes, recovery codes or session cookies.

The seeded service records are demo/mock mappings. Do not advertise guaranteed delivery until a real provider is connected and the service has been tested.

## Local setup

1. Install Node.js 20+ and PostgreSQL.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` and a strong `JWT_SECRET`.
4. Add Paystack and provider credentials only to `.env`/deployment secrets.
5. Run:

```bash
npm install
npm run migrate
npm run seed
npm start
```

Open `http://localhost:3000`.

## Docker

```bash
docker compose up --build
```

## Deployment

For Render/Railway/Fly.io or another Node host:

- Build: `npm ci`
- Start: `node server/scripts/migrate.js && node server/index.js`
- Add all environment variables from `.env.example`
- Provision PostgreSQL and set `DATABASE_URL`
- Set `APP_URL` and `PAYSTACK_CALLBACK_URL` to the public HTTPS URL
- Configure Paystack webhook/callback according to your Paystack dashboard
- Add `SMM_AFRICA_KEY` as a server-side secret

## Paystack flow

`POST /api/payments/paystack/initialize` creates a pending payment.
Paystack returns an authorization URL.
`GET /api/payments/paystack/callback` verifies the reference server-side.
Only a verified successful transaction credits the user's wallet.
The code also checks for an existing payment transaction before crediting to reduce duplicate-credit risk.

## Provider flow

`GET /api/provider/services` fetches provider services server-side.
`GET /api/provider/balance` checks provider balance.
`POST /api/orders` deducts wallet balance in a database transaction and creates the provider order.
Provider order ID/status are stored.

Before production, map your provider's service IDs to the local `services.provider_service_id` values and test with small legitimate orders.

## Admin

The seed script creates an admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
Change the password immediately in a real deployment.

## Legal/product notes

Use truthful service descriptions and pricing. Make it clear when services are supplied by a third-party provider. Do not claim endorsement by Meta, TikTok, YouTube, X, WhatsApp or other platforms unless you have documented authorization.
