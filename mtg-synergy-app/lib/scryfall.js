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

/**
 * Looks up full card data for a list of card names from Scryfall.
 * Returns a Map keyed by lowercased card name -> Scryfall card object.
 * Names that Scryfall can't find are silently skipped.
 */
export async function getCardDetails(names) {
  const unique = [...new Set(names.map(normalizeName).filter(Boolean))];
  const map = new Map();

  for (const batch of chunkArray(unique, CHUNK_SIZE)) {
    const identifiers = batch.map((name) => ({ name }));
    let res;
    try {
      res = await fetch(SCRYFALL_COLLECTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers }),
      });
    } catch (err) {
      // Network hiccup on one batch shouldn't kill the whole request.
      continue;
    }

    if (!res.ok) continue;

    const data = await res.json();
    for (const card of data.data || []) {
      map.set(card.name.toLowerCase(), card);
    }

    // Be polite to Scryfall's rate limits (they ask for ~50-100ms between requests).
    await new Promise((r) => setTimeout(r, 100));
  }

  return map;
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
  const isLegendaryCreature =
    typeLine.includes("Legendary") && typeLine.includes("Creature");

  const oracleText =
    card.oracle_text ||
    (card.card_faces || []).map((f) => f.oracle_text || "").join(" ");
  const explicitlyCommander = oracleText.includes("can be your commander");

  return isLegendaryCreature || explicitlyCommander;
}

/**
 * Picks a reasonable art image URL for a card, handling double-faced cards.
 */
export function getArtCrop(card) {
  if (!card) return null;
  if (card.image_uris && card.image_uris.art_crop) return card.image_uris.art_crop;
  if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
    return card.card_faces[0].image_uris.art_crop || null;
  }
  return null;
}
