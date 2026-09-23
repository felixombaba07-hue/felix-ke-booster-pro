const PAYSTACK_BASE = "https://api.paystack.co";

async function paystackRequest(path, options = {}) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("Paystack secret key is not configured");
  }

  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || `Paystack HTTP ${response.status}`);
  }
  return data;
}

async function initialize({ email, amount, reference, callback_url }) {
  return paystackRequest("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({ email, amount: Math.round(amount * 100), reference, callback_url })
  });
}

async function verify(reference) {
  return paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, {
    method: "GET"
  });
}

module.exports = { initialize, verify };
