# Deployment checklist

## 1. Database
- Create a PostgreSQL database.
- Set `DATABASE_URL`.
- Run `npm run migrate`.
- Run `npm run seed`.

## 2. Secrets
Set these in the host's secret/environment-variable manager:
- `JWT_SECRET`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_PUBLIC_KEY`
- `SMM_AFRICA_KEY`
- `DATABASE_URL`

Never commit `.env`.

## 3. Paystack
- Set the callback URL to your public HTTPS `/api/payments/paystack/callback`.
- Verify transactions server-side.
- Test with Paystack's test environment before switching to live credentials.

## 4. Provider
- Verify your provider account/API access.
- Sync services using the admin provider endpoint.
- Map provider service IDs to local service records.
- Set `mock_provider=false` only for a service that is actually mapped and tested.
- Start with small legitimate orders.

## 5. Production safety
- Change the seeded admin password.
- Use HTTPS.
- Keep secrets server-side.
- Do not collect social-media passwords/2FA/session cookies.
- Publish truthful service descriptions, pricing and third-party disclosures.
- Add your final Terms, Privacy and Refund pages before public launch.
