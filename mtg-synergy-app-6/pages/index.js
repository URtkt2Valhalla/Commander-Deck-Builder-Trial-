import { useState, useCallback, useRef, useMemo } from "react";
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
  return [...names].sort((a, b) => a.localeCompare(b));
}

function synergyColor(synergy) {
  if (synergy === null || synergy === undefined) return "#9aa0a6";
  if (synergy >= 30) return "#4caf7d";
  if (synergy >= 15) return "#8fbf6c";
  if (synergy >= 0) return "#c9c9c9";
  return "#c97a7a";
}

// Safely parses a fetch Response as JSON, giving a clear error instead of
// a cryptic browser exception (e.g. Safari's "The string did not match the
// expected pattern") when the server returns something that isn't JSON -
// which happens if a serverless function times out or crashes and the
// hosting platform serves its own HTML error page instead.
async function parseJsonResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!contentType.includes("application/json")) {
    if (res.status === 504 || res.status === 502) {
      throw new Error(
        "The server took too long to respond. Please try again."
      );
    }
    throw new Error(
      `Server returned an unexpected response (status ${res.status}) instead of data.`
    );
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("Server returned malformed data. Please try again.");
  }
}

const MAX_SEARCH_RESULTS = 25;

export default function Home() {
  const [stage, setStage] = useState("upload"); // upload -> search -> results
  const [collectionNames, setCollectionNames] = useState([]);
  const [fileName, setFileName] = useState("");
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
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
      complete: (parsed) => {
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
        setLoadingMsg("");
        setStage("search");
      },
      error: (err) => {
        setError(`Couldn't parse that CSV: ${err.message}`);
        setLoadingMsg("");
      },
    });
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return collectionNames.filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_SEARCH_RESULTS);
  }, [searchQuery, collectionNames]);

  const pickCommander = async (name) => {
    setError("");
    setLoadingMsg(`Checking "${name}"\u2026`);

    try {
      const checkRes = await fetch("/api/commander", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commanderName: name }),
      });
      const checkData = await parseJsonResponse(checkRes);
      if (!checkRes.ok) {
        // Not a legal commander (or not found) - stay on the search stage
        // so they can try a different card.
        setError(checkData.error || "That card isn't a valid commander.");
        setLoadingMsg("");
        return;
      }

      setSelectedCommander(checkData);
      setResults(null);
      setStage("results");
      setLoadingMsg(`Pulling EDHREC synergy data for ${checkData.name}\u2026`);

      const synergyRes = await fetch("/api/synergy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commanderName: checkData.name,
          ownedCardNames: collectionNames,
        }),
      });
      const synergyData = await parseJsonResponse(synergyRes);
      if (!synergyRes.ok) throw new Error(synergyData.error || "Failed to fetch synergy data");
      setResults(synergyData);
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
    setSearchQuery("");
    setSelectedCommander(null);
    setResults(null);
  };

  const backToSearch = () => {
    setStage("search");
    setError("");
    setResults(null);
    setSelectedCommander(null);
  };

  return (
    <div className="container">
      <h1>Commander Synergy Finder</h1>
      <p className="subtitle">
        Upload your collection, search for a card you own, pick it as your
        commander, and see which of your own cards EDHREC says synergize
        best with it.
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

      {/* Step 2: Search your collection for a commander */}
      {stage === "search" && (
        <div className="card">
          <div className="step-label">Step 2</div>
          <p>
            Loaded <strong>{fileName}</strong> &mdash; {collectionNames.length}{" "}
            unique cards. Search for the card you want to use as your commander.
          </p>

          <input
            type="text"
            autoFocus
            placeholder="Start typing a card name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />

          {loadingMsg && <p className="status-line">{loadingMsg}</p>}
          {error && <div className="error-box">{error}</div>}

          {searchQuery.trim() && (
            <div className="search-results-list">
              {searchResults.length === 0 ? (
                <p className="status-line">No cards in your collection match "{searchQuery}".</p>
              ) : (
                searchResults.map((name) => (
                  <button
                    key={name}
                    className="search-result-item"
                    onClick={() => pickCommander(name)}
                    disabled={!!loadingMsg}
                  >
                    {name}
                  </button>
                ))
              )}
              {searchResults.length === MAX_SEARCH_RESULTS && (
                <p className="status-line">
                  Showing the first {MAX_SEARCH_RESULTS} matches &mdash; keep typing to narrow it down.
                </p>
              )}
            </div>
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
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
            {selectedCommander?.image && (
              <img
                src={selectedCommander.image}
                alt={selectedCommander.name}
                style={{ width: 90, borderRadius: 8 }}
              />
            )}
            <p style={{ margin: 0 }}>
              Synergy picks for <strong>{selectedCommander?.name}</strong> from your
              collection
            </p>
          </div>

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
            <button className="btn secondary" onClick={backToSearch}>
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
