import { getCardDetails, isLegalCommander, getCardImage } from "../../lib/scryfall";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { cardNames } = req.body || {};
  if (!Array.isArray(cardNames) || cardNames.length === 0) {
    return res.status(400).json({ error: "cardNames must be a non-empty array" });
  }

  try {
    const details = await getCardDetails(cardNames);
    const commanders = [];

    for (const name of new Set(cardNames)) {
      const card = details.get(name.trim().toLowerCase());
      if (card && isLegalCommander(card)) {
        const displayName = card.name.includes(" // ")
          ? card.name.split(" // ")[0].trim()
          : card.name;
        commanders.push({
          name: displayName,
          image: getCardImage(card),
          colorIdentity: card.color_identity || [],
        });
      }
    }

    commanders.sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ commanders, checked: cardNames.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
