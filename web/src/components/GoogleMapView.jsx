import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  APIProvider,
  Map,
  Marker,
  InfoWindow,
  useMap,
  useApiLoadingStatus,
  APILoadingStatus,
} from '@vis.gl/react-google-maps';

const LAGOS_CENTER = { lat: 6.5244, lng: 3.3792 };

// Custom Green Destination Pin (SVG data URI)
const GREEN_PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46">
  <defs>
    <filter id="shadow" x="-20%" y="-10%" width="140%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <path d="M17 1C8.16 1 1 8.16 1 17c0 12.8 16 28 16 28s16-15.2 16-28C33 8.16 25.84 1 17 1z" fill="#1B633C" stroke="#FFFFFF" stroke-width="2.5" filter="url(#shadow)"/>
  <circle cx="17" cy="17" r="7.5" fill="#FFFFFF"/>
  <path d="M17 12.5v9M12.5 17h9" stroke="#1B633C" stroke-width="2.5" stroke-linecap="round"/>
</svg>
`.trim();

const makeCandidateSvg = (num) => `
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42">
  <defs>
    <filter id="c-shadow" x="-20%" y="-10%" width="140%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <path d="M15 1C7.8 1 2 6.8 2 14c0 10.5 13 27 13 27s13-16.5 13-27c0-7.2-5.8-13-13-13z" fill="#0F3323" stroke="#FFFFFF" stroke-width="2" filter="url(#c-shadow)"/>
  <circle cx="15" cy="14" r="8" fill="#FFFFFF"/>
  <text x="15" y="18" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="800" fill="#0F3323" text-anchor="middle">${num}</text>
</svg>
`.trim();

function getGreenPinIcon() {
  if (typeof window !== 'undefined' && window.google?.maps) {
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(GREEN_PIN_SVG),
      scaledSize: new window.google.maps.Size(34, 46),
      anchor: new window.google.maps.Point(17, 46),
    };
  }
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(GREEN_PIN_SVG) };
}

function getCandidateIcon(num) {
  const svg = makeCandidateSvg(num);
  if (typeof window !== 'undefined' && window.google?.maps) {
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new window.google.maps.Size(30, 42),
      anchor: new window.google.maps.Point(15, 42),
    };
  }
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg) };
}

function extractLatLng(e) {
  if (!e) return null;
  if (e.detail?.latLng) {
    const { lat, lng } = e.detail.latLng;
    return [typeof lat === 'function' ? lat() : lat, typeof lng === 'function' ? lng() : lng];
  }
  if (e.latLng) {
    const lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : e.latLng.lat;
    const lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : e.latLng.lng;
    return [lat, lng];
  }
  return null;
}

function MapBoundsHandler({ pin, candidates }) {
  const map = useMap();
  const candidatesSignature = useMemo(
    () => (candidates || []).map((c) => `${c.id || c.name}:${c.lat}:${c.lon}`).join('|'),
    [candidates]
  );
  const prevSignatureRef = useRef('');

  // When candidate list changes (new search result)
  useEffect(() => {
    if (!map) return;
    if (candidatesSignature === prevSignatureRef.current) return;
    prevSignatureRef.current = candidatesSignature;

    if (candidates && candidates.length > 0) {
      if (typeof window !== 'undefined' && window.google?.maps) {
        const bounds = new window.google.maps.LatLngBounds();
        candidates.forEach((c) => {
          if (typeof c.lat === 'number' && typeof c.lon === 'number') {
            bounds.extend({ lat: c.lat, lng: c.lon });
          }
        });
        if (pin && typeof pin[0] === 'number' && typeof pin[1] === 'number') {
          bounds.extend({ lat: pin[0], lng: pin[1] });
        }
        map.fitBounds(bounds, { top: 44, bottom: 44, left: 44, right: 44 });

        const listener = window.google.maps.event.addListenerOnce(map, 'idle', () => {
          if (map.getZoom() > 16) map.setZoom(16);
        });
        return () => window.google.maps.event.removeListener(listener);
      }
    } else if (pin && typeof pin[0] === 'number' && typeof pin[1] === 'number') {
      map.panTo({ lat: pin[0], lng: pin[1] });
      map.setZoom(14);
    } else {
      map.setCenter(LAGOS_CENTER);
      map.setZoom(11);
    }
  }, [map, candidatesSignature]);

  // When pin changes externally (e.g. typing into coordinate inputs)
  const prevPinRef = useRef(pin);
  useEffect(() => {
    if (!map || !pin) return;
    const [lat, lng] = pin;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    const prev = prevPinRef.current;
    prevPinRef.current = pin;

    if (!prev || prev[0] !== lat || prev[1] !== lng) {
      map.panTo({ lat, lng });
    }
  }, [map, pin?.[0], pin?.[1]]);

  return null;
}

function MapCanvas({
  pin,
  onMove,
  candidates,
  active,
  mapType,
  selectedId,
  onSelectCandidate,
}) {
  const [infoWindowOpen, setInfoWindowOpen] = useState(true);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const loadingStatus = useApiLoadingStatus();

  // Sync candidate popup when selectedId changes externally
  useEffect(() => {
    if (selectedId && candidates) {
      const match = candidates.find((c) => c.id === selectedId);
      if (match) setSelectedCandidate(match);
    }
  }, [selectedId, candidates]);

  // Re-open info window on destination pin whenever pin moves
  useEffect(() => {
    if (pin) setInfoWindowOpen(true);
  }, [pin?.[0], pin?.[1]]);

  if (loadingStatus === APILoadingStatus.FAILED || loadingStatus === APILoadingStatus.AUTH_FAILURE) {
    return (
      <div className="map-fallback-view error" role="region" aria-label="Map status">
        <div className="fallback-header">
          <span className="fallback-glyph">⚠</span>
          <h4>Failed to load map</h4>
        </div>
        <p className="fallback-text">
          Google Maps could not be initialized. Please verify your API key restrictions and network connection.
        </p>
        <p className="fallback-note">
          Manual coordinate pinning remains fully available below.
        </p>
      </div>
    );
  }

  const greenIcon = getGreenPinIcon();

  const handleMapClick = (e) => {
    if (!active) return;
    const coords = extractLatLng(e);
    if (coords) {
      setSelectedCandidate(null);
      onMove(coords);
      setInfoWindowOpen(true);
    }
  };

  return (
    <Map
      defaultCenter={LAGOS_CENTER}
      defaultZoom={11}
      mapTypeId={mapType}
      gestureHandling="greedy"
      streetViewControl={false}
      fullscreenControl={false}
      mapTypeControl={false}
      zoomControl={true}
      onClick={handleMapClick}
      className="google-map-element"
    >
      <MapBoundsHandler pin={pin} candidates={candidates} />

      {/* Candidate Landmark Reference Markers */}
      {candidates?.map((c, idx) => (
        <Marker
          key={c.id || idx}
          position={{ lat: c.lat, lng: c.lon }}
          icon={getCandidateIcon(idx + 1)}
          title={`${c.name} · Approximate landmark reference`}
          onClick={() => {
            if (onSelectCandidate) onSelectCandidate(c);
            setSelectedCandidate(c);
            setInfoWindowOpen(false);
          }}
        />
      ))}

      {/* Candidate Popup InfoWindow */}
      {selectedCandidate && (
        <InfoWindow
          position={{ lat: selectedCandidate.lat, lng: selectedCandidate.lon }}
          pixelOffset={[0, -42]}
          onCloseClick={() => setSelectedCandidate(null)}
        >
          <div className="gm-info-window">
            <strong>{selectedCandidate.name}</strong>
            <span>Approximate landmark reference</span>
          </div>
        </InfoWindow>
      )}

      {/* Draggable Green Destination Pin */}
      {pin && typeof pin[0] === 'number' && typeof pin[1] === 'number' && (
        <Marker
          position={{ lat: pin[0], lng: pin[1] }}
          draggable={Boolean(active)}
          icon={greenIcon}
          title="Your proposed destination · pending review"
          onDragStart={() => {
            setSelectedCandidate(null);
            setInfoWindowOpen(false);
          }}
          onDragEnd={(e) => {
            const coords = extractLatLng(e);
            if (coords) {
              onMove(coords);
              setInfoWindowOpen(true);
            }
          }}
          onClick={() => {
            setSelectedCandidate(null);
            setInfoWindowOpen((prev) => !prev);
          }}
        />
      )}

      {/* InfoWindow on Destination Pin */}
      {pin && infoWindowOpen && typeof pin[0] === 'number' && (
        <InfoWindow
          position={{ lat: pin[0], lng: pin[1] }}
          pixelOffset={[0, -46]}
          onCloseClick={() => setInfoWindowOpen(false)}
        >
          <div className="gm-info-window destination">
            <strong>Your proposed destination · pending review</strong>
          </div>
        </InfoWindow>
      )}
    </Map>
  );
}

export default function GoogleMapView({
  pin,
  onMove,
  candidates = [],
  active = true,
  result = null,
  selectedId = null,
  onSelectCandidate,
}) {
  const [mapType, setMapType] = useState('hybrid'); // 'hybrid' | 'roadmap'
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  return (
    <div className="google-map-wrapper">
      <div className="map-header">
        <div className="map-title">
          <span className="live-dot" />
          <span>Lagos Satellite Reference</span>
        </div>

        <div className="map-header-actions">
          <span className="map-coords-badge">BBOX 6.3°N–6.8°N · 2.7°E–4.0°E</span>
          {/* Map Type Toggle: Hybrid (default) vs Roadmap */}
          <div className="map-type-toggle" role="group" aria-label="Map style toggle">
            <button
              type="button"
              className={`toggle-btn ${mapType === 'hybrid' ? 'active' : ''}`}
              onClick={() => setMapType('hybrid')}
            >
              Satellite
            </button>
            <button
              type="button"
              className={`toggle-btn ${mapType === 'roadmap' ? 'active' : ''}`}
              onClick={() => setMapType('roadmap')}
            >
              Roadmap
            </button>
          </div>
        </div>
      </div>

      <div className="map-container" tabIndex={0} aria-label="Interactive map region">
        {!apiKey ? (
          <div className="map-fallback-view" role="region" aria-label="Map configuration notice">
            <div className="fallback-header">
              <span className="fallback-glyph">🗺</span>
              <h4>Google Maps API Key Not Configured</h4>
            </div>
            <p className="fallback-text">
              Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in your environment to render satellite imagery.
            </p>
            <div className="fallback-instructions">
              <strong>Coordinate inputs remain fully functional below:</strong>
              <p>
                You can still inspect ranked candidates and enter destination coordinates directly in the confirmation form.
              </p>
            </div>
          </div>
        ) : (
          <APIProvider apiKey={apiKey}>
            <MapCanvas
              pin={pin}
              onMove={onMove}
              candidates={candidates}
              active={active}
              mapType={mapType}
              selectedId={selectedId}
              onSelectCandidate={onSelectCandidate}
            />
          </APIProvider>
        )}

        <div className="map-floating-hint">
          {result ? 'Click the map or drag the green pin' : 'Enter an address to explore landmarks'}
        </div>
      </div>
    </div>
  );
}
