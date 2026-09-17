import { getCardByName, isLegalCommander, getCardImage, frontFaceName } from "../../lib/scryfall";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { commanderName } = req.body || {};
  if (!commanderName || typeof commanderName !== "string") {
    return res.status(400).json({ error: "commanderName is required" });
  }

  try {
    const card = await getCardByName(commanderName);

    if (!card) {
      return res.status(404).json({
        error: `Scryfall doesn't recognize "${commanderName}" as an exact card name. Double-check the spelling matches your collection export.`,
      });
    }

    if (!isLegalCommander(card)) {
      return res.status(400).json({
        error: `${card.name} isn't a legal commander - it's not a legendary creature and doesn't have "can be your commander" text.`,
      });
    }

    return res.status(200).json({
      name: frontFaceName(card),
      image: getCardImage(card),
      colorIdentity: card.color_identity || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
