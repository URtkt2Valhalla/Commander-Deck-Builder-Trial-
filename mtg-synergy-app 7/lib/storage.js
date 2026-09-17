// Minimal Upstash Redis REST client.
//
// Vercel's Marketplace Redis integration (Storage tab -> Redis -> Create ->
// Connect to Project) injects connection credentials as environment
// variables automatically. The exact variable names have changed a couple
// of times as Vercel's storage products have evolved, so this checks the
// most likely names rather than assuming one specific pair - if none of
// these match what got created, add REDIS_URL and REDIS_TOKEN manually in
// Project Settings -> Environment Variables using the values Vercel shows
// for your database (see README).

function getCreds() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_TOKEN;

  if (!url || !token) {
    throw new Error(
      "No Redis connection found. Make sure a Redis database is connected to this project in Vercel's Storage tab (see README), or add REDIS_URL and REDIS_TOKEN environment variables manually."
    );
  }
  return { url, token };
}

async function command(parts) {
  const { url, token } = getCreds();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Redis command failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

/** Reads a JSON value previously stored with kvSet. Returns null if unset. */
export async function kvGet(key) {
  const result = await command(["GET", key]);
  return result === null || result === undefined ? null : JSON.parse(result);
}

/** Stores a JSON-serializable value under a key. */
export async function kvSet(key, value) {
  await command(["SET", key, JSON.stringify(value)]);
}
