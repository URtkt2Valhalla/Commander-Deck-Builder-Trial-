// Maps ManaBox's CSV column names to a normalized card record used
// throughout the app, and provides merge logic for combining an existing
// stored collection with newly-uploaded rows.

/**
 * Reconstructs row objects from the compact wire format used when
 * uploading a collection: { columns: [...], rows: [[v1, v2, ...], ...] }
 * instead of one object per row repeating every column name. For a
 * multi-thousand-row ManaBox export this roughly halves the upload size,
 * which matters because serverless functions have a hard request-size
 * ceiling (around 4.5MB on Vercel) that a large collection sent as
 * full objects-per-row can approach.
 */
export function rowsFromCompact(columns, compactRows) {
  return compactRows.map((values) => {
    const row = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });
    return row;
  });
}

const COLUMNS = {
  name: "Name",
  binderName: "Binder Name",
  binderType: "Binder Type",
  setCode: "Set code",
  setName: "Set name",
  collectorNumber: "Collector number",
  foil: "Foil",
  rarity: "Rarity",
  quantity: "Quantity",
  manaboxId: "ManaBox ID",
  scryfallId: "Scryfall ID",
  purchasePrice: "Purchase price",
  condition: "Condition",
  language: "Language",
  purchasePriceCurrency: "Purchase price currency",
  added: "Added",
};

function toNumber(val, fallback) {
  if (val === undefined || val === null || val === "") return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Converts raw ManaBox CSV rows (as parsed by Papaparse with header: true)
 * into normalized card records. Rows without a card name are dropped.
 */
export function normalizeRows(rawRows) {
  return rawRows
    .filter((row) => row[COLUMNS.name] && String(row[COLUMNS.name]).trim())
    .map((row) => ({
      name: String(row[COLUMNS.name]).trim(),
      binderName: row[COLUMNS.binderName] || "",
      binderType: row[COLUMNS.binderType] || "",
      setCode: row[COLUMNS.setCode] || "",
      setName: row[COLUMNS.setName] || "",
      collectorNumber: row[COLUMNS.collectorNumber] || "",
      foil: row[COLUMNS.foil] || "normal",
      rarity: row[COLUMNS.rarity] || "",
      quantity: toNumber(row[COLUMNS.quantity], 1) || 1,
      manaboxId: row[COLUMNS.manaboxId] || "",
      scryfallId: row[COLUMNS.scryfallId] || "",
      purchasePrice: toNumber(row[COLUMNS.purchasePrice], null),
      purchasePriceCurrency: row[COLUMNS.purchasePriceCurrency] || "",
      condition: row[COLUMNS.condition] || "",
      language: row[COLUMNS.language] || "en",
      added: row[COLUMNS.added] || "",
    }));
}

/**
 * A stable key identifying one specific physical entry (a given card name +
 * printing + foiling + condition + language). Two rows with the same key
 * are treated as the same entry when merging, and their quantities are
 * summed rather than creating a duplicate row.
 */
export function cardKey(card) {
  return [card.name, card.setCode, card.collectorNumber, card.foil, card.condition, card.language]
    .join("|")
    .toLowerCase();
}

/**
 * Merges newly-uploaded cards into an existing collection. Matching entries
 * (same printing/foil/condition/language) have their quantities summed;
 * new entries are appended. Used for "add cards" uploads, as opposed to a
 * full "replace collection" which just swaps the list outright.
 */
export function mergeCards(existingCards, newCards) {
  const map = new Map(existingCards.map((c) => [cardKey(c), c]));
  for (const card of newCards) {
    const key = cardKey(card);
    const existing = map.get(key);
    if (existing) {
      map.set(key, { ...existing, quantity: existing.quantity + card.quantity });
    } else {
      map.set(key, card);
    }
  }
  return [...map.values()];
}

/**
 * Whether a card entry counts as genuinely "owned" for deck-building
 * purposes. ManaBox's "list" binder type covers both wishlists (like a
 * "Want" binder - cards you don't own yet) and things like a "sell list"
 * (cards you still physically own, just earmarked to sell). We can't tell
 * those apart by binder type alone, so we treat anything literally named
 * "sell list" as still-owned, and everything else of type "list" as not
 * owned (a wishlist).
 */
export function isOwned(card) {
  if (card.binderType !== "list") return true;
  return card.binderName.trim().toLowerCase() === "sell list";
}
