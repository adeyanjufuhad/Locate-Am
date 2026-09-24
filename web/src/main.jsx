import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import GoogleMapView from './components/GoogleMapView.jsx';
import './styles.css';

const API = import.meta.env.VITE_API_URL || '/api';
const DEFAULT_CENTER = [6.5244, 3.3792];

async function apiRequest(path, body) {
  const response = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Check your address and pin. Both must be inside the Lagos pilot area.');
  }
  return data;
}

function App() {
  const [address, setAddress] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [pin, setPin] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [consent, setConsent] = useState(false);
  const [adjusted, setAdjusted] = useState(false);

  const searchCounter = useRef(0);
  const dirty = Boolean(result && address.trim() !== query);
  const inBounds = Boolean(pin && pin[0] >= 6.3 && pin[0] <= 6.8 && pin[1] >= 2.7 && pin[1] <= 4.0);

  const movePin = (newCoords) => {
    setPin(newCoords);
    setAdjusted(true);
  };

  async function handleSearch(e, sampleText) {
    if (e) e.preventDefault();
    const targetAddress = (sampleText ?? address).trim();
    if (targetAddress.length < 3 || busy || sending) return;

    if (sampleText) setAddress(sampleText);
    const searchId = ++searchCounter.current;

    setBusy(true);
    setError('');
    setResult(null);
    setSaved(false);
    setPin(null);
    setConsent(false);
    setAdjusted(false);
    setSelected(null);

    try {
      const data = await apiRequest('/geocode', { address: targetAddress });
      if (searchId !== searchCounter.current) return;
      setResult(data);
      setQuery(targetAddress);
      const initialCandidate = data.reference || data.candidates[0];
      setPin(initialCandidate ? [initialCandidate.lat, initialCandidate.lon] : DEFAULT_CENTER);
      setSelected(initialCandidate?.id || null);
    } catch (err) {
      setError(err.message || 'Cannot reach the geocoding API. Please verify the backend is running.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!consent || !inBounds || !adjusted || sending || dirty) return;
    setSending(true);
    setError('');
    try {
      await apiRequest('/confirm', {
        address: query,
        lat: pin[0],
        lon: pin[1],
        candidate_id: selected,
        confirmation_token: result.confirmation_token,
        consent,
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="LocateAm Home">
          <span className="logo-symbol">⌖</span>
          <span>Locate<span className="brand-accent">Am</span></span>
        </a>
        <div className="pilot-tag">
          <span className="live-dot" />
          <span>LAGOS PILOT · {result?.data_mode === 'postgres' ? 'POSTGIS LIVE' : 'DEMO MODE'}</span>
        </div>
      </header>

      <main>
        <section className="intro">
          <div className="eyebrow">Local Directions · Spatial Precision</div>
          <h1>Find the place behind the address.</h1>
          <p className="intro-desc">
            Nigerian addresses rely on landmarks, junctions, and descriptive references. LocateAm resolves the landmark anchor, ranks candidates, and verifies the final destination pin.
          </p>
        </section>

        <div className="workspace">
          {/* Left Column: Search & Candidate Inspection */}
          <section className="panel search-panel" aria-label="Address search">
            <div className="step-tag">
              <span className="step-num">01</span>
              <span>Describe the Place</span>
            </div>

            <form onSubmit={handleSearch}>
              <label htmlFor="address">Where are you trying to find?</label>
              <textarea
                id="address"
                maxLength={300}
                minLength={3}
                required
                value={address}
                disabled={busy || sending}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Opposite Computer Village, Ikeja or Near Ikeja City Mall, Alausa"
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || sending || address.trim().length < 3}
              >
                <span>{busy ? 'Finding landmarks…' : 'Find this address'}</span>
                <span>↗</span>
              </button>
            </form>

            <div className="examples">
              <div className="examples-label">Try a Test Reference</div>
              <button
                type="button"
                className="example-chip"
                disabled={busy || sending}
                onClick={(e) => handleSearch(e, 'Opp. Demo Palm Market, Ikeja')}
              >
                Opp. Demo Palm Market, Ikeja ↗
              </button>
              <button
                type="button"
                className="example-chip"
                disabled={busy || sending}
                onClick={(e) => handleSearch(e, 'A landmark with two possible locations')}
              >
                A landmark with two possible locations ↗
              </button>
              <button
                type="button"
                className="example-chip"
                disabled={busy || sending}
                onClick={(e) => handleSearch(e, 'Near Ikeja City Mall, Alausa')}
              >
                Near Ikeja City Mall, Alausa (Neon OSM) ↗
              </button>
            </div>

            {busy && (
              <div role="status" className="notice info">
                Analyzing address syntax and matching spatial candidates in PostGIS…
              </div>
            )}

            {error && (
              <div role="alert" className="notice error">
                {error}
              </div>
            )}

            {result && (
              <>
                {dirty && (
                  <div className="notice warning">
                    Address input changed. Run search again before confirming a pin.
                  </div>
                )}

                <div className="parsed">
                  <div className="step-tag">
                    <span className="step-num">02</span>
                    <span>What We Understood</span>
                  </div>
                  <dl className="parsed-grid">
                    <div className="parsed-cell">
                      <dt>Landmark</dt>
                      <dd>{result.parsed.landmark || 'Not identified'}</dd>
                    </div>
                    <div className="parsed-cell">
                      <dt>Area Hint</dt>
                      <dd>{result.parsed.area || 'Not identified'}</dd>
                    </div>
                    <div className="parsed-cell">
                      <dt>Relation</dt>
                      <dd>{result.parsed.relation || 'At landmark'}</dd>
                    </div>
                  </dl>
                </div>

                <div className="result-header">
                  <h2>Possible landmarks</h2>
                  <span className="result-count">{result.candidates.length} candidate{result.candidates.length === 1 ? '' : 's'}</span>
                </div>

                <div role="status" className={`notice ${result.needs_pin ? 'warning' : 'info'}`}>
                  {!result.candidates.length
                    ? 'No usable match found. Place your pin on the map to anchor the destination.'
                    : result.reason === 'ambiguous_match'
                    ? 'More than one place could fit this address. Choose a reference below, then place your destination pin.'
                    : result.needs_pin
                    ? 'We need your help with the final location. Move the pin to the destination.'
                    : 'Strong landmark match. Note: this remains an approximate reference, not a verified delivery entrance.'}
                </div>

                <div className="candidate-list">
                  {result.candidates.map((c, idx) => (
                    <button
                      type="button"
                      key={c.id}
                      className={`candidate-item ${selected === c.id ? 'selected' : ''}`}
                      disabled={saved || sending || dirty}
                      onClick={() => {
                        setSelected(c.id);
                        setPin([c.lat, c.lon]);
                        setAdjusted(false);
                      }}
                    >
                      <span className="candidate-num">{idx + 1}</span>
                      <div className="candidate-info">
                        <strong className="candidate-name">{c.name}</strong>
                        <div className="candidate-meta">
                          <span>{c.area || 'Area unrecorded'}</span>
                          <span>·</span>
                          <span>{c.category || 'landmark'}</span>
                          <span>·</span>
                          <span>{c.source} ({c.dataset_version})</span>
                        </div>
                      </div>
                      <div className="candidate-score">
                        {c.ranking_score.toFixed(2)}
                        <small>rank</small>
                      </div>
                    </button>
                  ))}
                </div>

                <p className="fine-print">
                  Ranking scores compare relative candidate relevance. They are honest uncalibrated weights, not statistical probabilities.
                </p>
              </>
            )}
          </section>

          {/* Right Column: Cartographic Instrument & Pin Confirmation */}
          <section className="panel map-panel" aria-label="Map and confirmation">
            <GoogleMapView
              pin={pin}
              onMove={movePin}
              candidates={result?.candidates}
              active={Boolean(result && !saved && !sending && !dirty)}
              result={result}
              selectedId={selected}
              onSelectCandidate={(cand) => {
                setSelected(cand.id);
                setPin([cand.lat, cand.lon]);
                setAdjusted(false);
              }}
            />

            <div className="confirmation-section">
              <div className="step-tag">
                <span className="step-num">03</span>
                <span>Confirm the Last Few Metres</span>
              </div>

              {!result ? (
                <div className="confirmation-empty">
                  <div className="empty-icon">⌖</div>
                  <h3>A landmark gets you close.</h3>
                  <p>Your confirmed pin identifies the exact delivery gate, entrance, or stop.</p>
                </div>
              ) : saved ? (
                <div className="notice success" role="status">
                  <strong>Pin submitted for review.</strong>
                  <p>Your coordinate has been safely quarantined for review. It does not silently alter results until verified.</p>
                </div>
              ) : (
                <div className="confirmation-active">
                  <h3>Where is the actual destination?</h3>
                  <p>The landmark is an approximate reference. Adjust the green pin or enter exact coordinates.</p>

                  <div className="coords-row">
                    <div className="coords-field">
                      <label htmlFor="input-lat">Latitude</label>
                      <input
                        id="input-lat"
                        aria-label="Latitude"
                        type="number"
                        step="any"
                        min="6.3"
                        max="6.8"
                        disabled={sending || dirty}
                        value={pin?.[0] ?? ''}
                        onChange={(e) => movePin([Number(e.target.value), pin[1]])}
                      />
                    </div>
                    <div className="coords-field">
                      <label htmlFor="input-lon">Longitude</label>
                      <input
                        id="input-lon"
                        aria-label="Longitude"
                        type="number"
                        step="any"
                        min="2.7"
                        max="4.0"
                        disabled={sending || dirty}
                        value={pin?.[1] ?? ''}
                        onChange={(e) => movePin([pin[0], Number(e.target.value)])}
                      />
                    </div>
                  </div>

                  {!inBounds && (
                    <p className="notice error">Please place the pin inside the Lagos pilot boundaries (6.3°N–6.8°N, 2.7°E–4.0°E).</p>
                  )}

                  <label className="consent-checkbox">
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={sending || dirty}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span>
                      I agree to store this address and pin for moderation review. I confirm I have authorization to share this delivery location.
                    </span>
                  </label>

                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!consent || !inBounds || !adjusted || sending || dirty}
                    onClick={handleConfirm}
                  >
                    <span>{sending ? 'Submitting for review…' : 'Submit pin for review'}</span>
                    <span>→</span>
                  </button>

                  {!adjusted && (
                    <p className="fine-print">Move the pin or edit a coordinate before submitting.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <footer>
          <div className="footer-brand">
            <span>◎ LocateAm Geocoder</span>
            <span>·</span>
            <span>Lagos-First Nigerian Landmark Engine</span>
          </div>
          <div className="footer-meta">
            {result?.data_mode === 'postgres' ? 'Landmark data © OpenStreetMap contributors · Neon PostGIS' : 'Fictional Demo Dataset'} · Real-World Accuracy Uncalibrated
          </div>
        </footer>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
