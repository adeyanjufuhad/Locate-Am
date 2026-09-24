import json
import math
import pytest
from fastapi.testclient import TestClient
from api.config import Settings
from api.main import create_app
from api.parse import normalize, parse_address
from api.match import rank, distance_m
from api.store import ROOT
from scripts.import_places import records, usable
from scripts.benchmark import evaluate

ALIASES = json.loads((ROOT/'data/area_aliases.json').read_text())


@pytest.fixture
def client(tmp_path):
    settings = Settings(_env_file=None, demo_db=str(tmp_path/'test.db'), signing_secret='s'*32)
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.mark.parametrize('text,expected', [
    ('opp. the school, nr jnc b/stop', 'opposite the school near junction bus stop'),
    ('  ALLEN RD, IKEJA!  ', 'allen road ikeja'),
    ('VI', 'vi'), ('b/stop, JCT', 'bus stop junction')])
def test_normalize(text, expected):
    assert normalize(text) == expected


def test_parser():
    p = parse_address('3rd gate after Demo Palm Market, Ikeja', ALIASES)
    assert (p['landmark'], p['relation'], p['area']) == ('demo palm market', 'after', 'ikeja')
    assert parse_address('nr Demo Lagoon Library V.I.', ALIASES)['area'] == 'victoria island'
    assert parse_address('Demo Orchid School, Lekki phase 1', ALIASES)['landmark'] == 'demo orchid school'
    assert parse_address('Victoria gardens', ALIASES)['area'] is None
    assert parse_address('Ikeja', ALIASES)['landmark'] is None
    assert parse_address('Market Ikeja Yaba', ALIASES)['area_ambiguous']


def search(client, text):
    response = client.post('/geocode', json={'address': text})
    assert response.status_code == 200, response.text
    return response.json()


def test_exact_and_approximate(client):
    result = search(client, 'Demo Palm Market Ikeja')
    assert result['reference']['coordinate_kind'] == 'approximate_landmark_reference'
    assert result['reference']['lat'] == 6.601
    assert result['reference']['lon'] == 3.351
    assert not result['needs_pin']
    assert not result['delivery_entrance_verified']
    result = search(client, 'opp Demo Palm Market Ikeja')
    assert result['needs_pin'] and result['reference']


def test_ambiguous_and_wrong_area(client):
    result = search(client, 'Demo Unity Filling Station')
    assert result['reference'] is None and result['needs_pin']
    assert result['reason'] == 'ambiguous_match'
    # Even an incorrect parsed area cannot remove an exact landmark.
    result = search(client, 'Demo Palm Market Yaba')
    assert result['candidates'][0]['id'] == 'demo-1'
    result = search(client, 'Demo Unity Filling Station Ikeja')
    assert result['needs_pin']  # weak area hint cannot settle two branches


def test_empty_and_fuzzy(client):
    assert search(client, 'Ikeja')['candidates'] == []
    assert search(client, 'zzzzzzzz qqqqqq')['reference'] is None
    assert search(client, 'Demo Palm Markte Ikeja')['candidates'][0]['id'] == 'demo-1'


def confirmation(result, **changes):
    return {'address':'opp Demo Palm Market Ikeja','lat':6.602,'lon':3.352,
            'confirmation_token':result['confirmation_token'], 'candidate_id':'demo-1',
            'consent':True, **changes}


def test_confirm_quarantine_and_replay(client):
    result = search(client, 'opp Demo Palm Market Ikeja')
    response = client.post('/confirm', json=confirmation(result))
    assert response.status_code == 202 and response.json()['status'] == 'pending'
    assert response.json()['affects_search'] is False
    assert client.post('/confirm', json=confirmation(result)).status_code == 409
    again = search(client, 'opp Demo Palm Market Ikeja')
    assert again['reference']['lat'] == 6.601
    with client.app.state.store.connect() as conn:
        row = conn.execute('SELECT lat,lon,status FROM pin_corrections').fetchone()
        assert row == (6.602, 3.352, 'pending')


@pytest.mark.parametrize('changes,status', [
    ({'lat':3.352,'lon':6.602},422), ({'lat':90},422),
    ({'consent':False},400), ({'candidate_id':'made-up'},400),
    ({'address':'Another address'},400), ({'confirmation_token':'x'*80},400)])
def test_confirm_validation(client, changes, status):
    result = search(client, 'opp Demo Palm Market Ikeja')
    assert client.post('/confirm', json=confirmation(result, **changes)).status_code == status


def test_api_limits(client, tmp_path):
    assert client.get('/health').json()['data_mode'] == 'demo'
    for address in ('', '  ', '123456', 'x'*301):
        assert client.post('/geocode', json={'address':address}).status_code == 422
    assert client.post('/geocode', content='x'*9000).status_code == 413
    settings = Settings(_env_file=None, demo_db=str(tmp_path/'limited.db'), requests_per_minute=1)
    with TestClient(create_app(settings)) as limited:
        assert limited.post('/geocode',json={'address':'Ikeja'}).status_code == 200
        assert limited.post('/geocode',json={'address':'Ikeja'},headers={'X-Forwarded-For':'1.2.3.4'}).status_code == 429


def test_distance():
    assert distance_m(6.6,3.3,6.6,3.3) == 0
    assert 110 < distance_m(6.6,3.3,6.601,3.3) < 112
    assert 109 < distance_m(6.6,3.3,6.6,3.301) < 112


def test_import_validation():
    rows = list(records({'elements':[
        {'type':'node','id':1,'lat':6.6,'lon':3.3,'tags':{'name':'Fixture only'}},
        {'type':'way','id':2,'center':{'lat':6.5,'lon':3.4},'tags':{'name':'Test'}},
        {'type':'node','id':3,'lat':3.3,'lon':6.6,'tags':{'name':'Swapped'}}]}, 'osm'))
    assert [usable(r) for r in rows] == [True, True, False]
    assert rows[1]['lat'] == 6.5
    rows[0]['lat'] = math.nan
    assert not usable(rows[0])
    overture = list(records({'features':[{'properties':{'id':'1','names':{'primary':'Fixture'}},'geometry':{'type':'Point','coordinates':[3.3,6.6]}}]}, 'overture'))
    assert usable(overture[0]) and overture[0]['lon'] == 3.3


def test_benchmark_denominators():
    dataset = {'kind':'synthetic','rows':[{'address':'a','lat':6.6,'lon':3.3},{'address':'b','lat':6.6,'lon':3.3}]}
    def geocode(address):
        return {'reference':{'lat':6.6,'lon':3.3} if address=='a' else None,'needs_pin':address=='b','candidates':[]}
    result = evaluate(dataset, geocode)
    assert result['within_m_all_addresses']['100'] == .5
    assert result['result_share'] == .5 and result['requires_pin_share'] == .5
    assert result['median_error_m_returned_references'] == 0
    assert result['real_world_accuracy'] == 'unmeasured'


def test_configurable_thresholds(client):
    p = parse_address('Demo Palm Market Ikeja', ALIASES)
    settings = Settings(_env_file=None, accept_score=1, min_name_score=1)
    assert rank(p, client.app.state.store.candidates(p['landmark']), settings)['reference']
