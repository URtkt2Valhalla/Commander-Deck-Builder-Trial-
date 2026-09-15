// Helpers for pulling synergy data off EDHREC commander pages.
//
// EDHREC has no official public API. This fetches the same page a browser
// would load and reads the data out of it two ways:
//   1. (Preferred) EDHREC is a Next.js site, so the page ships a
//      <script id="__NEXT_DATA__"> tag containing the exact same structured
//      data used to render the cardlists. We look for card-shaped objects
//      in there directly -- this is far more reliable than scraping text.
//   2. (Fallback) If that structure ever changes, we fall back to reading
//      the rendered text of the page, which lists each card as:
//        Card Name
//        NN%inclusion...
//        NN%synergy
//      the same three-line pattern, in order, for every card on the page.
//
// Because this relies on EDHREC's current page structure, it may need
// small updates if EDHREC redesigns their site.

const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

/**
 * Turns a card name into EDHREC's URL slug convention, e.g.
 * "Jodah, the Unifier" -> "jodah-the-unifier"
 * "Kenrith, the Returned King" -> "kenrith-the-returned-king"
 * Double-faced cards ("Front // Back") use the front face name only.
 */
export function slugify(cardName) {
  const front = cardName.split("//")[0].trim();
  return front
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (e.g. Dáin -> Dain)
    .replace(/[^a-z0-9\s-]/g, "") // drop punctuation like apostrophes/commas
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function stripHtmlToLines(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n");

  text = text
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");

  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function extractFromRenderedText(html) {
  const lines = stripHtmlToLines(html);
  const results = [];

  for (let i = 0; i < lines.length - 2; i++) {
    const inclMatch = lines[i + 1] && lines[i + 1].match(/^([\d.]+)%inclusion/);
    const synMatch = lines[i + 2] && lines[i + 2].match(/^(-?\d+)%synergy/);
    if (inclMatch && synMatch) {
      results.push({
        name: lines[i],
        inclusion: parseFloat(inclMatch[1]),
        synergy: parseInt(synMatch[1], 10),
      });
    }
  }
  return results;
}

function extractFromNextData(html) {
  const match = html.match(NEXT_DATA_RE);
  if (!match) return [];

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (err) {
    return [];
  }

  const found = [];
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const name = node.name || node.sanitized || null;
    const synergyVal = typeof node.synergy === "number" ? node.synergy : null;
    const inclusionVal =
      typeof node.inclusion === "number"
        ? node.inclusion
        : typeof node.num_decks === "number" && typeof node.potential_decks === "number"
        ? (node.num_decks / node.potential_decks) * 100
        : null;

    if (name && (synergyVal !== null || inclusionVal !== null) && !seen.has(name)) {
      seen.add(name);
      found.push({
        name,
        synergy: synergyVal !== null ? Math.round(synergyVal * 100) : null,
        inclusion: inclusionVal,
      });
    }

    for (const key in node) {
      walk(node[key]);
    }
  }

  walk(data);
  return found;
}

/**
 * Fetches and parses the EDHREC commander page for the given commander name.
 * Returns { cards, sourceUrl } where cards is a flat list of
 * { name, synergy, inclusion } across every category on the page.
 */
export async function fetchCommanderSynergy(commanderName) {
  const slug = slugify(commanderName);
  const url = `https://edhrec.com/commanders/${slug}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MTGCollectionSynergyTool/1.0; personal use)",
      Accept: "text/html",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Couldn't find an EDHREC page for "${commanderName}" (tried ${url}, got status ${res.status}). ` +
        `EDHREC's URL for this commander may not match the guessed slug.`
    );
  }

  const html = await res.text();

  let cards = extractFromNextData(html);
  if (!cards.length) {
    cards = extractFromRenderedText(html);
  }

  if (!cards.length) {
    throw new Error(
      `Fetched the EDHREC page for "${commanderName}" but couldn't find any card data on it. ` +
        `EDHREC may have changed their page structure.`
    );
  }

  return { cards, sourceUrl: url };
}
