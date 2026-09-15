// Helpers for talking to Scryfall's free public API.
// Docs: https://scryfall.com/docs/api/cards/collection

const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const CHUNK_SIZE = 75; // Scryfall's max identifiers per request

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// Cleans up ManaBox-style card names before sending to Scryfall.
// ManaBox sometimes exports double-faced cards as "Front // Back" which
// Scryfall's name-based lookup also understands, so we mostly pass names
// through as-is. We just trim whitespace.
function normalizeName(name) {
  return name.trim();
}

// Requests are paced by time (not just capped by concurrency count), and
// spaced this far apart, so we stay reliably under Scryfall's documented
// guidance of under 10 requests/second. The previous concurrency-based
// approach (N requests "in flight" at once) let fast responses cause real
// throughput to burst well above that limit, which is why the majority of
// batches were getting rate-limited even with retries.
const START_INTERVAL_MS = 120; // ~8 requests/second
const MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchBatch(batch, errorLog) {
  const identifiers = batch.map((name) => ({ name }));

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(SCRYFALL_COLLECTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Scryfall requires a descriptive User-Agent and an Accept header on
          // every request as of their API hardening update - requests with a
          // generic/default header (like Node's default) get rejected.
          "User-Agent": "CommanderSynergyFinder/1.0 (personal-use MTG collection tool)",
          Accept: "application/json;q=0.9,*/*;q=0.8",
        },
        body: JSON.stringify({ identifiers }),
      });

      if (res.status === 429 || res.status >= 500) {
        // Rate limited or a transient server error - back off and retry
        // instead of silently dropping this batch's cards. Backoff is kept
        // short and capped: this runs inside a serverless function with a
        // hard time limit, so a handful of slow retries across many
        // batches can add up to a timeout, which is worse than a card or
        // two occasionally missing.
        if (attempt < MAX_RETRIES) {
          const retryAfter = parseFloat(res.headers.get("retry-after") || "0");
          const backoff = retryAfter > 0 ? Math.min(retryAfter * 1000, 1500) : 250 * (attempt + 1);
          await sleep(backoff);
          continue;
        }
        errorLog.push(
          `Scryfall returned ${res.status} for a batch of ${batch.length} cards after ${MAX_RETRIES} retries`
        );
        return [];
      }

      if (!res.ok) {
        errorLog.push(`Scryfall returned ${res.status} for a batch of ${batch.length} cards`);
        return [];
      }

      const data = await res.json();
      return data.data || [];
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      errorLog.push(`Network error fetching a batch: ${err.message}`);
      return [];
    }
  }

  return [];
}

/**
 * Indexes a card under every name a collection export might reasonably use
 * to refer to it. Double-faced cards (transforming, modal, etc.) have a
 * Scryfall `name` that's the two faces joined with " // ", e.g.
 * "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel" - but most
 * collection apps (ManaBox included) export just the front face name. If we
 * only indexed the combined name, every double-faced card would silently
 * fail to match and get dropped from results.
 */
function indexCard(map, card) {
  map.set(card.name.toLowerCase(), card);
  if (card.name.includes(" // ")) {
    const frontFace = card.name.split(" // ")[0].trim();
    map.set(frontFace.toLowerCase(), card);
  }
}

/**
 * Looks up full card data for a list of card names from Scryfall.
 * Returns a Map keyed by lowercased card name -> Scryfall card object.
 * Names that Scryfall can't find are silently skipped.
 *
 * Requests are dispatched with a fixed spacing between each one starting
 * (rather than a concurrency cap), which directly controls request rate
 * and keeps us under Scryfall's rate limit regardless of how fast or slow
 * individual responses come back.
 */
export async function getCardDetails(names) {
  const unique = [...new Set(names.map(normalizeName).filter(Boolean))];
  const batches = chunkArray(unique, CHUNK_SIZE);
  const map = new Map();
  const errorLog = [];

  const pending = [];
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await sleep(START_INTERVAL_MS);
    pending.push(fetchBatch(batches[i], errorLog));
  }
  const results = await Promise.all(pending);
  for (const cards of results) {
    for (const card of cards) {
      indexCard(map, card);
    }
  }

  // Surface a clear signal if every batch failed, so this doesn't just look
  // like "you own zero commanders" with no explanation.
  if (map.size === 0 && batches.length > 0 && errorLog.length === batches.length) {
    const err = new Error(
      `Couldn't reach Scryfall for any of your cards (${errorLog[0]}). This is likely a temporary Scryfall API issue rather than a problem with your collection.`
    );
    err.scryfallErrors = errorLog;
    throw err;
  }

  return { map, failedBatches: errorLog.length, totalBatches: batches.length };
}

/**
 * Determines whether a Scryfall card object is legal to use as a Commander.
 * Covers: legendary creatures, and cards with explicit
 * "can be your commander" text (some planeswalkers, backgrounds' partners, etc).
 */
export function isLegalCommander(card) {
  if (!card) return false;
  if (card.legalities && card.legalities.commander !== "legal") return false;

  const typeLine = card.type_line || "";
  const facesTypeLine = (card.card_faces || []).map((f) => f.type_line || "").join(" ");
  const isLegendaryCreature =
    (typeLine.includes("Legendary") && typeLine.includes("Creature")) ||
    (facesTypeLine.includes("Legendary") && facesTypeLine.includes("Creature"));

  const oracleText =
    card.oracle_text ||
    (card.card_faces || []).map((f) => f.oracle_text || "").join(" ");
  const explicitlyCommander = oracleText.includes("can be your commander");

  return isLegendaryCreature || explicitlyCommander;
}

/**
 * Picks the best card image URL, preferring the full card face (not just a
 * cropped bit of art) so the commander picker shows the whole card.
 * Handles double-faced cards by using the front face.
 */
export function getCardImage(card) {
  if (!card) return null;
  if (card.image_uris) {
    return card.image_uris.normal || card.image_uris.small || card.image_uris.art_crop || null;
  }
  if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
    const f = card.card_faces[0].image_uris;
    return f.normal || f.small || f.art_crop || null;
  }
  return null;
}
