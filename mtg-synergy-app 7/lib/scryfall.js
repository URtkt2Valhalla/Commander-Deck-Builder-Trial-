// Helpers for talking to Scryfall's free public API.
// Docs: https://scryfall.com/docs/api/cards/named
//
// This app only ever looks up ONE card at a time now - whichever commander
// the user searches for and picks from their own collection - rather than
// bulk-checking every card a collection contains. That sidesteps rate
// limiting entirely: a single request is never going to trip a "too many
// requests" lockout, no matter how many times a person uses the app.

const SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named";

function scryfallHeaders() {
  return {
    // Scryfall requires a descriptive User-Agent and an Accept header on
    // every request as of their API hardening update - requests with a
    // generic/default header (like Node's default) get rejected.
    "User-Agent": "CommanderSynergyFinder/1.0 (personal-use MTG collection tool)",
    Accept: "application/json;q=0.9,*/*;q=0.8",
  };
}

/**
 * Looks up a single card by its exact name. Returns the Scryfall card
 * object, or null if no card with that exact name exists.
 */
export async function getCardByName(name) {
  const url = `${SCRYFALL_NAMED_URL}?exact=${encodeURIComponent(name.trim())}`;
  const res = await fetch(url, { headers: scryfallHeaders() });

  if (res.status === 404) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Scryfall lookup failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`
    );
  }

  return res.json();
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
 * cropped bit of art). Handles double-faced cards by using the front face.
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

/**
 * The clean, single-face display/lookup name for a card - double-faced
 * cards report their Scryfall `name` as "Front // Back", but EDHREC and
 * most collection exports refer to them by the front face only.
 */
export function frontFaceName(card) {
  return card.name.includes(" // ") ? card.name.split(" // ")[0].trim() : card.name;
}
