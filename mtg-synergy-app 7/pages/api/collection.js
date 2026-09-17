import { kvGet, kvSet } from "../../lib/storage";
import { normalizeRows, mergeCards, rowsFromCompact } from "../../lib/collection";

const COLLECTION_KEY = "collection:v1";

// The default Next.js body size limit (1mb) is too small for a multi-
// thousand-card collection upload, and Vercel's own serverless function
// limit is around 4.5mb - this raises Next's own ceiling while staying
// safely under that platform limit.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const stored = await kvGet(COLLECTION_KEY);
      return res.status(200).json({
        cards: stored?.cards || [],
        updatedAt: stored?.updatedAt || null,
      });
    }

    if (req.method === "POST" || req.method === "PATCH") {
      const { columns, rows } = req.body || {};
      if (!Array.isArray(columns) || !Array.isArray(rows)) {
        return res.status(400).json({ error: "columns and rows arrays are required" });
      }

      const rawRows = rowsFromCompact(columns, rows);
      const newCards = normalizeRows(rawRows);
      if (newCards.length === 0) {
        return res.status(400).json({ error: "No valid card rows found in that file." });
      }

      let finalCards;
      if (req.method === "POST") {
        // Replace the collection entirely.
        finalCards = newCards;
      } else {
        // PATCH: merge into the existing collection (matching entries have
        // quantities summed, new ones are appended).
        const stored = await kvGet(COLLECTION_KEY);
        finalCards = mergeCards(stored?.cards || [], newCards);
      }

      const payload = { cards: finalCards, updatedAt: new Date().toISOString() };
      await kvSet(COLLECTION_KEY, payload);
      return res.status(200).json(payload);
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
