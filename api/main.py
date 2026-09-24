import base64
import hashlib
import hmac
import json
import logging
import time
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ConfigDict, field_validator
from api.config import get_settings
from api.parse import parse_address, normalize
from api.match import rank
from api.store import Store


class AddressInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    address: str = Field(min_length=3, max_length=300)

    @field_validator('address')
    @classmethod
    def usable(cls, value):
        if len(normalize(value)) < 3 or not any(c.isalpha() for c in value):
            raise ValueError('Enter an address containing a landmark or area name')
        return value.strip()


class ConfirmInput(AddressInput):
    lat: float = Field(ge=6.3, le=6.8, allow_inf_nan=False)
    lon: float = Field(ge=2.7, le=4.0, allow_inf_nan=False)
    candidate_id: str | None = Field(None, max_length=50)
    confirmation_token: str = Field(min_length=20, max_length=4000)
    consent: bool


def create_app(settings=None):
    settings = settings or get_settings()
    store = Store(settings)
    app = FastAPI(title='LocateAm', version='0.1.0')
    app.state.store = store
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])

    @app.middleware('http')
    async def body_limit(request, call_next):
        # Count actual bytes, including chunked requests without Content-Length.
        if request.method == 'POST':
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 8192:
                    return JSONResponse(status_code=413, content={'detail': 'Request too large'})
            request._body = bytes(body)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(Exception)
    async def failure(request, exc):
        # Do not log request bodies, coordinates, credentials or SQL parameters.
        logging.getLogger('locateam').error('Service failure: %s', type(exc).__name__)
        return JSONResponse(status_code=503, content={'detail': 'Data service unavailable. Please try again.'})

    def limited(request, action, maximum, seconds):
        # Never trust client-supplied X-Forwarded-For. Run uvicorn --no-proxy-headers.
        ip = request.client.host if request.client else 'unknown'
        key = hmac.new(settings.signing_secret.encode(), f'{action}:{ip}'.encode(), hashlib.sha256).hexdigest()
        if not store.consume_limit(key, maximum, seconds):
            raise HTTPException(429, 'Too many requests. Please try later.', headers={'Retry-After': str(seconds)})

    def sign(payload):
        data = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
        signature = hmac.new(settings.signing_secret.encode(), data.encode(), hashlib.sha256).hexdigest()
        return data + '.' + signature

    def verify(token, address):
        try:
            data, signature = token.rsplit('.', 1)
            expected = hmac.new(settings.signing_secret.encode(), data.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                raise ValueError()
            payload = json.loads(base64.urlsafe_b64decode(data))
            if payload['expires'] < time.time() or payload['address_hash'] != hashlib.sha256(normalize(address).encode()).hexdigest():
                raise ValueError()
            return payload
        except (ValueError, KeyError, TypeError):
            raise HTTPException(400, 'Confirmation expired or invalid. Search again.')

    @app.get('/health')
    def health():
        return {'status': 'ok', 'data_mode': settings.data_mode, 'usable_places': store.health(),
                'real_world_accuracy': 'unmeasured'}

    @app.post('/geocode')
    def geocode(body: AddressInput, request: Request):
        limited(request, 'geocode', settings.requests_per_minute, 60)
        parsed = parse_address(body.address, store.aliases())
        result = rank(parsed, store.candidates(parsed['landmark']), settings)
        token = sign({'id': str(uuid4()), 'expires': int(time.time())+1800,
                      'address_hash': hashlib.sha256(parsed['normalized'].encode()).hexdigest(),
                      'candidate_ids': [p['id'] for p in result['candidates']]})
        return {'parsed': parsed, **result, 'data_mode': settings.data_mode,
                'confirmation_token': token, 'confirmation_expires_in_seconds': 1800,
                'notice': 'Landmarks are approximate references, not verified delivery entrances.'}

    @app.post('/confirm', status_code=202)
    def confirm(body: ConfirmInput, request: Request):
        limited(request, 'confirm', settings.confirmations_per_hour, 3600)
        if not body.consent:
            raise HTTPException(400, 'Consent to store this address and pin for review is required')
        payload = verify(body.confirmation_token, body.address)
        if body.candidate_id is not None and body.candidate_id not in payload['candidate_ids']:
            raise HTTPException(400, 'Candidate was not returned for this search')
        id = str(uuid4())
        if not store.save_pin(id, normalize(body.address), body.lat, body.lon, body.candidate_id, payload['id']):
            raise HTTPException(409, 'This confirmation has already been submitted')
        return {'ok': True, 'id': id, 'status': 'pending', 'affects_search': False}

    return app


app = create_app()
