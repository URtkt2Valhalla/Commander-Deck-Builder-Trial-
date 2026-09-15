import { useState, useCallback, useRef } from "react";
import Papa from "papaparse";

// Column ManaBox (and most collection exports) use for the card name.
// If a different export format is used, we try a few common fallbacks.
const NAME_COLUMNS = ["Name", "name", "Card Name", "card_name", "Card"];

function extractCardNames(rows) {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]);
  const nameCol = NAME_COLUMNS.find((c) => columns.includes(c));
  if (!nameCol) return null; // signal "couldn't find a name column"

  const names = new Set();
  for (const row of rows) {
    const raw = row[nameCol];
    if (raw && typeof raw === "string" && raw.trim()) {
      names.add(raw.trim());
    }
  }
  return [...names];
}

function synergyColor(synergy) {
  if (synergy === null || synergy === undefined) return "#9aa0a6";
  if (synergy >= 30) return "#4caf7d";
  if (synergy >= 15) return "#8fbf6c";
  if (synergy >= 0) return "#c9c9c9";
  return "#c97a7a";
}

export default function Home() {
  const [stage, setStage] = useState("upload"); // upload -> commanders -> results
  const [collectionNames, setCollectionNames] = useState([]);
  const [fileName, setFileName] = useState("");
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [commanders, setCommanders] = useState([]);
  const [commanderSearch, setCommanderSearch] = useState("");
  const [selectedCommander, setSelectedCommander] = useState(null);
  const [results, setResults] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setError("");
    setFileName(file.name);
    setLoadingMsg("Reading your collection CSV\u2026");

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        const names = extractCardNames(parsed.data);
        if (names === null) {
          setError(
            "Couldn't find a card name column in this CSV. Expected a column called \"Name\" (this is how ManaBox exports it)."
          );
          setLoadingMsg("");
          return;
        }
        if (names.length === 0) {
          setError("That CSV didn't have any card names in it.");
          setLoadingMsg("");
          return;
        }
        setCollectionNames(names);
        await loadCommanders(names);
      },
      error: (err) => {
        setError(`Couldn't parse that CSV: ${err.message}`);
        setLoadingMsg("");
      },
    });
  }, []);

  const loadCommanders = async (names) => {
    setLoadingMsg(
      `Checking ${names.length} unique cards against Scryfall for legal commanders\u2026 this can take a bit for large collections.`
    );
    try {
      const res = await fetch("/api/commanders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardNames: names }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to look up commanders");

      setCommanders(data.commanders);
      if (data.warning) setError(data.warning);
      setStage("commanders");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMsg("");
    }
  };

  const pickCommander = async (commander) => {
    setSelectedCommander(commander);
    setError("");
    setResults(null);
    setLoadingMsg(`Pulling EDHREC synergy data for ${commander.name}\u2026`);
    setStage("results");

    try {
      const res = await fetch("/api/synergy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commanderName: commander.name,
          ownedCardNames: collectionNames,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch synergy data");
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMsg("");
    }
  };

  const reset = () => {
    setStage("upload");
    setCollectionNames([]);
    setFileName("");
    setError("");
    setCommanders([]);
    setCommanderSearch("");
    setSelectedCommander(null);
    setResults(null);
  };

  const filteredCommanders = commanders.filter((c) =>
    c.name.toLowerCase().includes(commanderSearch.trim().toLowerCase())
  );

  return (
    <div className="container">
      <h1>Commander Synergy Finder</h1>
      <p className="subtitle">
        Upload your collection, pick a commander you own, and see which of your
        own cards EDHREC says synergize best with it.
      </p>

      {/* Step 1: Upload */}
      {stage === "upload" && (
        <div className="card">
          <div className="step-label">Step 1</div>
          <div
            className="dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={(e) => handleFile(e.target.files[0])}
          />
          {loadingMsg && <p className="status-line">{loadingMsg}</p>}
          {error && <div className="error-box">{error}</div>}
        </div>
      )}

      {/* Step 2: Pick a commander */}
      {stage === "commanders" && (
        <div className="card">
          <div className="step-label">Step 2</div>
          <p>
            Loaded <strong>{fileName}</strong> &mdash; found{" "}
            <strong>{commanders.length}</strong> legal commanders in your collection
            out of {collectionNames.length} unique cards.
          </p>
          {error && <div className="error-box">{error}</div>}
          {commanders.length === 0 ? (
            <p>
              No legendary creatures (or other commander-eligible cards) were
              recognized in this collection.
            </p>
          ) : (
            <>
              <input
                type="text"
                placeholder={`Search ${commanders.length} commanders\u2026`}
                value={commanderSearch}
                onChange={(e) => setCommanderSearch(e.target.value)}
                className="search-input"
              />
              {filteredCommanders.length === 0 ? (
                <p className="status-line">No commanders match "{commanderSearch}".</p>
              ) : (
                <div className="commander-grid">
                  {filteredCommanders.map((c) => (
                    <button
                      key={c.name}
                      className="commander-tile"
                      onClick={() => pickCommander(c)}
                    >
                      {c.image && <img src={c.image} alt={c.name} loading="lazy" />}
                      <div className="commander-name">{c.name}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div style={{ marginTop: 20 }}>
            <button className="btn secondary" onClick={reset}>
              Start over
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Results */}
      {stage === "results" && (
        <div className="card">
          <div className="step-label">Step 3</div>
          <p>
            Synergy picks for <strong>{selectedCommander?.name}</strong> from your
            collection
          </p>

          {loadingMsg && <p className="status-line">{loadingMsg}</p>}
          {error && <div className="error-box">{error}</div>}

          {results && (
            <>
              <p className="status-line">
                You own <strong>{results.matches.length}</strong> of the{" "}
                {results.totalEdhrecCards} cards EDHREC associates with this
                commander.{" "}
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
                            style={{
                              color: synergyColor(m.synergy),
                              border: `1px solid ${synergyColor(m.synergy)}`,
                            }}
                          >
                            {m.synergy !== null ? `${m.synergy}%` : "\u2013"}
                          </span>
                        </td>
                        <td>
                          {m.inclusion !== null ? `${m.inclusion.toFixed(1)}%` : "\u2013"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => setStage("commanders")}>
              &larr; Pick a different commander
            </button>
            <button className="btn secondary" onClick={reset}>
              Start over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
