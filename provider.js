const API_URL = process.env.SMM_API_URL || "https://smm.africa/api/v3";

async function providerRequest(params) {
  if (!process.env.SMM_AFRICA_KEY) {
    throw new Error("SMM provider key is not configured");
  }

  const body = new URLSearchParams({
    key: process.env.SMM_AFRICA_KEY,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  });

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    throw new Error(`Provider HTTP ${response.status}`);
  }

  if (data?.error) throw new Error(data.error);
  return data;
}

async function getServices() {
  return providerRequest({ action: "services" });
}

async function getBalance() {
  return providerRequest({ action: "balance" });
}

async function createOrder({ service, link, quantity }) {
  return providerRequest({ action: "add", service, link, quantity });
}

async function getOrderStatus(order) {
  return providerRequest({ action: "status", order });
}

module.exports = { getServices, getBalance, createOrder, getOrderStatus };
