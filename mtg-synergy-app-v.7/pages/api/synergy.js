import { fetchCommanderSynergy } from "../../lib/edhrec";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { commanderName, ownedCardNames } = req.body || {};
  if (!commanderName || !Array.isArray(ownedCardNames)) {
    return res
      .status(400)
      .json({ error: "commanderName (string) and ownedCardNames (array) are required" });
  }

  try {
    const owned = new Set(
      ownedCardNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
    );

    const { cards, sourceUrl } = await fetchCommanderSynergy(commanderName);

    const matches = cards
      .filter((c) => owned.has(c.name.trim().toLowerCase()))
      // exclude the commander itself if EDHREC lists it among its own recs
      .filter((c) => c.name.trim().toLowerCase() !== commanderName.trim().toLowerCase())
      .sort((a, b) => (b.synergy ?? -1000) - (a.synergy ?? -1000));

    return res.status(200).json({
      matches,
      totalEdhrecCards: cards.length,
      sourceUrl,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
