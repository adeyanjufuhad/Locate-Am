"""Integration tests require a disposable, empty TEST_DATABASE_URL database."""
import json
import os
import pytest
import psycopg
from fastapi.testclient import TestClient
from api.config import Settings
from api.main import create_app
from scripts.migrate import migrate
from scripts.import_places import import_file


@pytest.mark.skipif(not os.getenv('TEST_DATABASE_URL'), reason='Requires disposable PostGIS TEST_DATABASE_URL')
def test_postgis_import_search_confirm(tmp_path):
    url = os.environ['TEST_DATABASE_URL']
    migrate(url)
    migrate(url)
    fixture = tmp_path/'osm.json'
    fixture.write_text(json.dumps({'elements':[
        {'type':'node','id':901,'lat':6.601,'lon':3.351,'tags':{'name':'Fixture Palm Market','addr:suburb':'Ikeja'}},
        {'type':'way','id':902,'center':{'lat':6.60101,'lon':3.35101},'tags':{'name':'Fixture Palm Market'}}]}))
    report = import_file(fixture,'osm','test-v1',url)
    assert report['inserted_places'] == 1 and report['merged_sources'] == 1
    report = import_file(fixture,'osm','test-v2',url)
    assert report['inserted_places'] == 0 and report['updated_sources'] == 2
    with TestClient(create_app(Settings(_env_file=None,data_mode='postgres',database_url=url,signing_secret='s'*32))) as client:
        result = client.post('/geocode',json={'address':'Fixture Palm Market Yaba'}).json()
        assert result['candidates'][0]['lat'] == 6.601
        response = client.post('/confirm',json={'address':'Fixture Palm Market Yaba','lat':6.602,'lon':3.352,'consent':True,'candidate_id':result['candidates'][0]['id'],'confirmation_token':result['confirmation_token']})
        assert response.status_code == 202
        with psycopg.connect(url) as conn:
            row = conn.execute('SELECT ST_Y(geom::geometry),ST_X(geom::geometry),status FROM pin_corrections WHERE id=%s',(response.json()['id'],)).fetchone()
            assert row == (6.602,3.352,'pending')
