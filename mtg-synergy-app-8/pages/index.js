import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import Papa from "papaparse";
import { isOwned } from "../lib/collection";

// Column ManaBox (and most collection exports) use for the card name.
const NAME_COLUMNS = ["Name", "name", "Card Name", "card_name", "Card"];

function synergyColor(synergy) {
  if (synergy === null || synergy === undefined) return "#9aa0a6";
  if (synergy >= 30) return "#4caf7d";
  if (synergy >= 15) return "#8fbf6c";
  if (synergy >= 0) return "#c9c9c9";
  return "#c97a7a";
}

// Safely parses a fetch Response as JSON, giving a clear error instead of
// a cryptic browser exception when the server returns something that
// isn't JSON (e.g. a timeout or platform error page).
async function parseJsonResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!contentType.includes("application/json")) {
    if (res.status === 504 || res.status === 502) {
      throw new Error("The server took too long to respond. Please try again.");
    }
    throw new Error(`Server returned an unexpected response (status ${res.status}).`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("Server returned malformed data. Please try again.");
  }
}

function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => resolve(parsed.data),
      error: (err) => reject(err),
    });
  });
}

function toCompactPayload(rawRows) {
  if (rawRows.length === 0) return { columns: [], rows: [] };
  const columns = Object.keys(rawRows[0]);
  const rows = rawRows.map((row) => columns.map((c) => (row[c] === undefined ? "" : row[c])));
  return { columns, rows };
}

const MAX_SEARCH_RESULTS = 25;
const RARITY_ORDER = ["common", "uncommon", "rare", "special", "mythic"];

export default function Home() {
  const [activeTab, setActiveTab] = useState("collection"); // collection | deck

  // ---- Persistent collection state ----
  const [collectionCards, setCollectionCards] = useState([]);
  const [collectionUpdatedAt, setCollectionUpdatedAt] = useState(null);
  const [collectionLoading, setCollectionLoading] = useState(true);
  const [collectionError, setCollectionError] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");
  const fileInputRef = useRef(null);
  const pendingModeRef = useRef("replace");

  // ---- Collection filters/sort ----
  const [search, setSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");
  const [foilFilter, setFoilFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");
  const [binderFilter, setBinderFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  // ---- Deck builder state ----
  const [deckStage, setDeckStage] = useState("search"); // search | results
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCommander, setSelectedCommander] = useState(null);
  const [results, setResults] = useState(null);
  const [deckLoadingMsg, setDeckLoadingMsg] = useState("");
  const [deckError, setDeckError] = useState("");

  const loadCollection = useCallback(async () => {
    setCollectionLoading(true);
    setCollectionError("");
    try {
      const res = await fetch("/api/collection");
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to load collection");
      setCollectionCards(data.cards);
      setCollectionUpdatedAt(data.updatedAt);
    } catch (err) {
      setCollectionError(err.message);
    } finally {
      setCollectionLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCollection();
  }, [loadCollection]);

  const triggerUpload = (mode) => {
    pendingModeRef.current = mode;
    fileInputRef.current?.click();
  };

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setCollectionError("");
    const mode = pendingModeRef.current;
    setUploadMsg(mode === "replace" ? "Reading and replacing your collection\u2026" : "Reading and adding cards\u2026");

    try {
      const rawRows = await parseCsvFile(file);
      if (rawRows.length === 0) {
        throw new Error("That CSV didn't have any rows in it.");
      }
      const columns = Object.keys(rawRows[0]);
      if (!NAME_COLUMNS.some((c) => columns.includes(c))) {
        throw new Error(
          'Couldn\'t find a card name column in this CSV. Expected a column called "Name" (this is how ManaBox exports it).'
        );
      }

      const payload = toCompactPayload(rawRows);
      const res = await fetch("/api/collection", {
        method: mode === "replace" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setCollectionCards(data.cards);
      setCollectionUpdatedAt(data.updatedAt);
    } catch (err) {
      setCollectionError(err.message);
    } finally {
      setUploadMsg("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  // ---- Derived collection data ----
  const rarities = useMemo(
    () => [...new Set(collectionCards.map((c) => c.rarity).filter(Boolean))].sort(
      (a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b)
    ),
    [collectionCards]
  );
  const binders = useMemo(
    () => [...new Set(collectionCards.map((c) => c.binderName).filter(Boolean))].sort(),
    [collectionCards]
  );
  const conditions = useMemo(
    () => [...new Set(collectionCards.map((c) => c.condition).filter(Boolean))].sort(),
    [collectionCards]
  );

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = collectionCards.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (rarityFilter && c.rarity !== rarityFilter) return false;
      if (foilFilter && c.foil !== foilFilter) return false;
      if (conditionFilter && c.condition !== conditionFilter) return false;
      if (binderFilter && c.binderName !== binderFilter) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case "price":
          return ((a.purchasePrice ?? -1) - (b.purchasePrice ?? -1)) * dir;
        case "rarity":
          return (RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)) * dir;
        case "quantity":
          return (a.quantity - b.quantity) * dir;
        case "name":
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
    return list;
  }, [collectionCards, search, rarityFilter, foilFilter, conditionFilter, binderFilter, sortBy, sortDir]);

  const totalCopies = useMemo(
    () => collectionCards.reduce((sum, c) => sum + c.quantity, 0),
    [collectionCards]
  );
  const totalValue = useMemo(
    () =>
      collectionCards.reduce((sum, c) => sum + (c.purchasePrice || 0) * c.quantity, 0),
    [collectionCards]
  );

  // Names available for deck-building: owned cards only (excludes wishlist-
  // type "list" binders like a ManaBox "Want" list).
  const ownedNames = useMemo(() => {
    const names = new Set();
    for (const c of collectionCards) {
      if (isOwned(c)) names.add(c.name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [collectionCards]);

  const deckSearchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return ownedNames.filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
  }, [searchQuery, ownedNames]);

  const pickCommander = async (name) => {
    setDeckError("");
    setDeckLoadingMsg(`Checking "${name}"\u2026`);

    try {
      const checkRes = await fetch("/api/commander", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commanderName: name }),
      });
      const checkData = await parseJsonResponse(checkRes);
      if (!checkRes.ok) {
        setDeckError(checkData.error || "That card isn't a valid commander.");
        setDeckLoadingMsg("");
        return;
      }

      setSelectedCommander(checkData);
      setResults(null);
      setDeckStage("results");
      setDeckLoadingMsg(`Pulling EDHREC synergy data for ${checkData.name}\u2026`);

      const synergyRes = await fetch("/api/synergy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commanderName: checkData.name, ownedCardNames: ownedNames }),
      });
      const synergyData = await parseJsonResponse(synergyRes);
      if (!synergyRes.ok) throw new Error(synergyData.error || "Failed to fetch synergy data");
      setResults(synergyData);
    } catch (err) {
      setDeckError(err.message);
    } finally {
      setDeckLoadingMsg("");
    }
  };

  const backToDeckSearch = () => {
    setDeckStage("search");
    setDeckError("");
    setResults(null);
    setSelectedCommander(null);
  };

  return (
    <div className="container">
      <h1>Commander Collection Manager</h1>
      <p className="subtitle">
        Your collection, saved and searchable &mdash; plus a synergy-based
        deck builder that only recommends cards you actually own.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files[0])}
      />

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === "collection" ? "active" : ""}`}
          onClick={() => setActiveTab("collection")}
        >
          Collection
        </button>
        <button
          className={`tab-btn ${activeTab === "deck" ? "active" : ""}`}
          onClick={() => setActiveTab("deck")}
        >
          Build a Deck
        </button>
      </div>

      {/* ---------------- Collection tab ---------------- */}
      {activeTab === "collection" && (
        <div className="card">
          {collectionLoading ? (
            <p className="status-line">Loading your saved collection…</p>
          ) : collectionCards.length === 0 ? (
            <>
              <div className="step-label">Get started</div>
              <div
                className="dropzone"
                onClick={() => triggerUpload("replace")}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  pendingModeRef.current = "replace";
                  handleFile(e.dataTransfer.files[0]);
                }}
              >
                <p>
                  <strong>Click to upload</strong> or drag in your ManaBox collection CSV
                </p>
                <p style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>
                  In ManaBox: Collection tab &rarr; menu &rarr; Export CSV
                </p>
              </div>
              {uploadMsg && <p className="status-line">{uploadMsg}</p>}
              {collectionError && <div className="error-box">{collectionError}</div>}
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <p className="status-line" style={{ margin: 0 }}>
                  <strong>{collectionCards.length}</strong> unique entries &middot;{" "}
                  <strong>{totalCopies}</strong> total cards &middot; est. value{" "}
                  <strong>${totalValue.toFixed(2)}</strong>
                  {collectionUpdatedAt && (
                    <> &middot; last updated {new Date(collectionUpdatedAt).toLocaleString()}</>
                  )}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn secondary" onClick={() => triggerUpload("add")}>
                    Add cards
                  </button>
                  <button className="btn secondary" onClick={() => triggerUpload("replace")}>
                    Replace collection
                  </button>
                </div>
              </div>

              {uploadMsg && <p className="status-line">{uploadMsg}</p>}
              {collectionError && <div className="error-box">{collectionError}</div>}

              <div className="filter-row">
                <input
                  type="text"
                  placeholder="Search by name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="search-input"
                  style={{ flex: "2 1 200px", margin: 0 }}
                />
                <select value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)} className="select-input">
                  <option value="">All rarities</option>
                  {rarities.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <select value={foilFilter} onChange={(e) => setFoilFilter(e.target.value)} className="select-input">
                  <option value="">Foil / Non-foil</option>
                  <option value="normal">Non-foil</option>
                  <option value="foil">Foil</option>
                  <option value="etched">Etched</option>
                </select>
                <select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)} className="select-input">
                  <option value="">All conditions</option>
                  {conditions.map((c) => (
                    <option key={c} value={c}>
                      {c.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <select value={binderFilter} onChange={(e) => setBinderFilter(e.target.value)} className="select-input">
                  <option value="">All binders</option>
                  {binders.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <select
                  value={`${sortBy}:${sortDir}`}
                  onChange={(e) => {
                    const [by, dir] = e.target.value.split(":");
                    setSortBy(by);
                    setSortDir(dir);
                  }}
                  className="select-input"
                >
                  <option value="name:asc">Name (A-Z)</option>
                  <option value="name:desc">Name (Z-A)</option>
                  <option value="price:desc">Price (high-low)</option>
                  <option value="price:asc">Price (low-high)</option>
                  <option value="rarity:desc">Rarity (high-low)</option>
                  <option value="quantity:desc">Quantity (high-low)</option>
                </select>
              </div>

              <p className="status-line">
                Showing {filteredCards.length} of {collectionCards.length} entries
              </p>

              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Set</th>
                      <th>Foil</th>
                      <th>Rarity</th>
                      <th>Condition</th>
                      <th>Qty</th>
                      <th>Price</th>
                      <th>Binder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCards.slice(0, 200).map((c, i) => (
                      <tr key={`${c.name}-${c.setCode}-${c.collectorNumber}-${c.foil}-${c.condition}-${i}`}>
                        <td>{c.name}</td>
                        <td>{c.setCode?.toUpperCase()}</td>
                        <td>{c.foil}</td>
                        <td>{c.rarity}</td>
                        <td>{c.condition.replace("_", " ")}</td>
                        <td>{c.quantity}</td>
                        <td>{c.purchasePrice != null ? `$${c.purchasePrice.toFixed(2)}` : "\u2013"}</td>
                        <td>{c.binderName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredCards.length > 200 && (
                <p className="status-line">Showing the first 200 matching rows &mdash; narrow your filters to see more precisely.</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------- Deck builder tab ---------------- */}
      {activeTab === "deck" && (
        <div className="card">
          {collectionCards.length === 0 ? (
            <p>Upload a collection on the Collection tab first.</p>
          ) : deckStage === "search" ? (
            <>
              <div className="step-label">Search your collection</div>
              <p>
                {ownedNames.length} owned cards available. Search for the card you want to use as your commander.
              </p>
              <input
                type="text"
                autoFocus
                placeholder="Start typing a card name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
              {deckLoadingMsg && <p className="status-line">{deckLoadingMsg}</p>}
              {deckError && <div className="error-box">{deckError}</div>}
              {searchQuery.trim() && (
                <div className="search-results-list">
                  {deckSearchResults.length === 0 ? (
                    <p className="status-line">No owned cards match "{searchQuery}".</p>
                  ) : (
                    deckSearchResults.map((name) => (
                      <button
                        key={name}
                        className="search-result-item"
                        onClick={() => pickCommander(name)}
                        disabled={!!deckLoadingMsg}
                      >
                        {name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="step-label">Synergy results</div>
              <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
                {selectedCommander?.image && (
                  <img src={selectedCommander.image} alt={selectedCommander.name} style={{ width: 90, borderRadius: 8 }} />
                )}
                <p style={{ margin: 0 }}>
                  Synergy picks for <strong>{selectedCommander?.name}</strong> from your collection
                </p>
              </div>

              {deckLoadingMsg && <p className="status-line">{deckLoadingMsg}</p>}
              {deckError && <div className="error-box">{deckError}</div>}

              {results && (
                <>
                  <p className="status-line">
                    You own <strong>{results.matches.length}</strong> of the {results.totalEdhrecCards} cards
                    EDHREC associates with this commander.{" "}
                    <a href={results.sourceUrl} target="_blank" rel="noreferrer">
                      View on EDHREC
                    </a>
                  </p>
                  {results.matches.length === 0 ? (
                    <p>No overlap found between your collection and EDHREC's list for this commander.</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Card</th>
                          <th>Synergy</th>
                          <th>Inclusion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.matches.map((m) => (
                          <tr key={m.name}>
                            <td>{m.name}</td>
                            <td>
                              <span
                                className="synergy-badge"
                                style={{ color: synergyColor(m.synergy), border: `1px solid ${synergyColor(m.synergy)}` }}
                              >
                                {m.synergy !== null ? `${m.synergy}%` : "\u2013"}
                              </span>
                            </td>
                            <td>{m.inclusion !== null ? `${m.inclusion.toFixed(1)}%` : "\u2013"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                <button className="btn secondary" onClick={backToDeckSearch}>
                  &larr; Pick a different commander
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
