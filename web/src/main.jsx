import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';

const API = import.meta.env.VITE_API_URL || '/api';
const DEFAULT = [6.55, 3.4];
const icon = (label, active=false) => L.divIcon({className:'map-icon',html:`<span class="map-dot ${active?'active':''}">${label}</span>`,iconSize:[32,40],iconAnchor:[16,36]});
async function request(path, body) {
  const response = await fetch(API+path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Check your address and pin. Both must be inside the Lagos pilot area.');
  return data;
}
function MapControl({pin, onMove, active}) {
  const map = useMap();
  useEffect(()=>{if(pin) map.setView(pin, 15);}, [pin?.[0],pin?.[1],map]);
  useMapEvents({click(e){if(active) onMove([e.latlng.lat,e.latlng.lng]);}});
  return null;
}
function App() {
  const [address,setAddress] = useState('');
  const [query,setQuery] = useState('');
  const [result,setResult] = useState(null);
  const [pin,setPin] = useState(null);
  const [selected,setSelected] = useState(null);
  const [busy,setBusy] = useState(false);
  const [sending,setSending] = useState(false);
  const [error,setError] = useState('');
  const [saved,setSaved] = useState(false);
  const [consent,setConsent] = useState(false);
  const [adjusted,setAdjusted] = useState(false);
  const [tilesFailed,setTilesFailed] = useState(false);
  const generation = useRef(0);
  const dirty = !!result && address.trim() !== query;
  const inBounds = pin && pin[0]>=6.3 && pin[0]<=6.8 && pin[1]>=2.7 && pin[1]<=4;
  const movePin = p => {setPin(p);setAdjusted(true);};
  async function search(e, example) {
    e?.preventDefault();
    const value = (example ?? address).trim();
    if(value.length<3 || busy || sending) return;
    if(example) setAddress(example);
    const version = ++generation.current;
    setBusy(true);setError('');setResult(null);setSaved(false);setPin(null);setConsent(false);setAdjusted(false);setSelected(null);
    try {
      const data = await request('/geocode',{address:value});
      if(version !== generation.current) return;
      setResult(data);setQuery(value);
      const first = data.reference || data.candidates[0];
      setPin(first ? [first.lat,first.lon] : DEFAULT);
      setSelected(first?.id || null);
    } catch(err) {setError(err.message || 'Cannot reach the API. Check that the backend is running.');}
    finally {setBusy(false);}
  }
  async function confirm() {
    setSending(true);setError('');
    try {
      await request('/confirm',{address:query,lat:pin[0],lon:pin[1],candidate_id:selected,confirmation_token:result.confirmation_token,consent});
      setSaved(true);
    } catch(err){setError(err.message);}
    finally{setSending(false);}
  }
  return <>
    <header className="topbar"><a className="brand" href="/" aria-label="LocateAm home"><span className="logo">◎</span> Locate<span>Am</span></a><span className="pilot"><i/> LAGOS PILOT</span></header>
    <main>
      <section className="intro"><div className="eyebrow">LOCAL DIRECTIONS. A CLEARER DESTINATION.</div><h1>Find the place<br/>behind the address.</h1><p>“After the junction. Opposite the market.”<br/>Start with a landmark. Help us find the last few metres.</p></section>
      <div className="workspace">
        <section className="panel search-panel" aria-label="Address search">
          <div className="step"><span>01</span> DESCRIBE THE PLACE</div>
          <form onSubmit={search}><label htmlFor="address">Where are you trying to find?</label><textarea id="address" maxLength={300} minLength={3} required value={address} disabled={busy||sending} onChange={e=>setAddress(e.target.value)} placeholder="e.g. Opposite Demo Palm Market, Ikeja"/><button className="primary" disabled={busy||sending||address.trim().length<3}>{busy?'Finding landmarks…':'Find this address'} <span>↗</span></button></form>
          <div className="examples"><span>TRY A FICTIONAL EXAMPLE</span><button disabled={busy||sending} onClick={e=>search(e,'Opp. Demo Palm Market, Ikeja')}>Opp. Demo Palm Market, Ikeja ↗</button><button disabled={busy||sending} onClick={e=>search(e,'Demo Unity Filling Station')}>A landmark with two possible locations ↗</button></div>
          {busy && <div role="status" className="notice">Reading the address and comparing landmarks…</div>}
          {error && <div role="alert" className="notice error">{error}</div>}
          {result && <>
            {dirty && <div className="notice warning">Address changed. Search again before confirming a pin.</div>}
            <div className="parsed"><div className="step"><span>02</span> WHAT WE UNDERSTOOD</div><dl><div><dt>Landmark</dt><dd>{result.parsed.landmark||'Not identified'}</dd></div><div><dt>Area hint</dt><dd>{result.parsed.area||'Not identified'}</dd></div><div><dt>Relation</dt><dd>{result.parsed.relation||'At landmark'}</dd></div></dl></div>
            <div className="result-heading"><h2>Possible landmarks</h2><span>{result.candidates.length} found</span></div>
            <div role="status" className={'notice '+(result.needs_pin?'warning':'')}>
              {!result.candidates.length ? 'No usable match. Place your pin on the map to show us the destination.' : result.reason==='ambiguous_match' ? 'More than one place could fit. Choose a reference, then place your destination pin.' : result.needs_pin ? 'We need your help with the final location. Move the pin to the destination.' : 'Strong landmark match. This is still an approximate reference, not a verified entrance.'}
            </div>
            <div className="candidates">{result.candidates.map((c,i)=><button className={'candidate '+(selected===c.id?'selected':'')} key={c.id} disabled={saved||sending||dirty} onClick={()=>{setSelected(c.id);setPin([c.lat,c.lon]);setAdjusted(false);}}><span className="number">{i+1}</span><span className="candidate-body"><strong>{c.name}</strong><small>{c.area||'Area not recorded'} · Approximate reference</small><small>{c.source} · {c.dataset_version}</small></span><span className="score">{c.ranking_score.toFixed(2)}<small>rank</small></span></button>)}</div>
            <p className="fine">Ranking scores compare matches. They are not probabilities.</p>
          </>}
        </section>
        <section className="panel map-panel" aria-label="Map and confirmation"><div className="map-heading"><span><i className="live-dot"/> Lagos, Nigeria</span><span>LANDMARK EXPLORER</span></div>
          <div className="map"><MapContainer center={DEFAULT} zoom={11} minZoom={9} maxBounds={[[6.3,2.7],[6.8,4.0]]} scrollWheelZoom={false}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" eventHandlers={{tileerror:()=>setTilesFailed(true)}}/>
            <MapControl pin={pin} active={!!result&&!saved&&!sending&&!dirty} onMove={movePin}/>
            {result?.candidates.map((c,i)=><Marker key={c.id} position={[c.lat,c.lon]} icon={icon(i+1)}><Popup>{c.name}<br/>Approximate landmark reference</Popup></Marker>)}
            {pin&&<Marker position={pin} draggable={!saved&&!sending&&!dirty} icon={icon('✚',true)} eventHandlers={{dragend:e=>{const p=e.target.getLatLng();movePin([p.lat,p.lng]);}}}><Popup>Your proposed destination · pending review</Popup></Marker>}
          </MapContainer><div className="map-caption">{result?'Click the map or drag the green pin':'Your search starts with a landmark'}</div></div>
          {tilesFailed&&<p className="notice warning">Map tiles could not load. You can still inspect candidates and enter coordinates below.</p>}
          <div className="confirmation"><div className="step"><span>03</span> CONFIRM THE LAST FEW METRES</div>
            {!result ? <div className="empty"><span>⌖</span><h2>A landmark gets you close.</h2><p>Your pin makes the destination clear.<br/>Search an address to get started.</p></div> : saved ? <div className="notice success" role="status"><strong>Pin submitted for review.</strong><p>Thank you. It has not changed search results and is not yet a verified location.</p></div> : <>
              <h2>Where is the actual destination?</h2><p>The landmark is a reference. Move the green pin, or enter the destination coordinates.</p>
              <div className="coordinates"><label>Latitude<input aria-label="Latitude" type="number" step="any" min="6.3" max="6.8" disabled={sending||dirty} value={pin?.[0]??''} onChange={e=>movePin([Number(e.target.value),pin[1]])}/></label><label>Longitude<input aria-label="Longitude" type="number" step="any" min="2.7" max="4" disabled={sending||dirty} value={pin?.[1]??''} onChange={e=>movePin([pin[0],Number(e.target.value)])}/></label></div>
              {!inBounds&&<p className="notice error">Please place the pin inside the Lagos pilot area.</p>}
              <label className="consent"><input type="checkbox" checked={consent} disabled={sending||dirty} onChange={e=>setConsent(e.target.checked)}/><span>I agree to store this address and pin for review. I have permission to share this location.</span></label>
              <button className="primary" disabled={!consent||!inBounds||!adjusted||sending||dirty} onClick={confirm}>{sending?'Submitting…':'Submit pin for review'} <span>→</span></button>
              {!adjusted&&<p className="fine">Move the pin or edit a coordinate before submitting.</p>}
            </>}
          </div>
        </section>
      </div>
      <footer><span>◎ Built for the way we give directions.</span><span>{result?.data_mode==='postgres'?'Open map data':'Fictional demo data'} · Real-world accuracy unmeasured</span></footer>
    </main>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
