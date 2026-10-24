"""Security-focused tests for the ML engine API. Run: python -m pytest tests (from ml-engine/)."""
import math
import os
import sys
import tempfile

# Keep the placeholder model out of the working tree.
os.environ['MODEL_DIR'] = tempfile.mkdtemp()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest  # noqa: E402

import api  # noqa: E402


@pytest.fixture
def client():
    api.sliding_window.service_stats.clear()
    return api.app.test_client()


def good(**over):
    body = {'service': 'project-1-server', 'level': 'ERROR', 'message': 'boom'}
    body.update(over)
    return body


def test_health(client):
    r = client.get('/health')
    assert r.status_code == 200
    assert r.get_json()['status'] == 'ok'


def test_score_happy_path(client):
    r = client.post('/score', json=good())
    assert r.status_code == 200
    s = r.get_json()['anomaly_score']
    assert isinstance(s, float) and math.isfinite(s)


def test_score_accepts_processor_levels(client):
    for level in ('FATAL', 'ERROR', 'WARNING'):
        assert client.post('/score', json=good(level=level)).status_code == 200


def test_oversized_body_413(client):
    r = client.post('/score', json=good(message='x' * 20000))
    assert r.status_code == 413
    assert r.get_json() == {'error': 'Request body too large'}


def test_message_too_long_400(client):
    assert client.post('/score', json=good(message='x' * 1001)).status_code == 400


def test_non_json_400(client):
    r = client.post('/score', data='service=a', content_type='application/x-www-form-urlencoded')
    assert r.status_code == 400
    r = client.post('/score', data='{not json', content_type='application/json')
    assert r.status_code == 400


@pytest.mark.parametrize('body', [[], 'str', 5, None])
def test_non_object_400(client, body):
    assert client.post('/score', json=body).status_code == 400


def test_unknown_field_400(client):
    r = client.post('/score', json=good(extra='x'))
    assert r.status_code == 400
    assert 'extra' not in r.get_data(as_text=True)


def test_bad_level_400_and_not_echoed(client):
    r = client.post('/score', json=good(level='<script>alert(1)</script>'))
    assert r.status_code == 400
    assert 'script' not in r.get_data(as_text=True)


@pytest.mark.parametrize('over', [
    {'service': 's' * 101}, {'service': 'bad name!'}, {'service': ''}, {'service': 5},
    {'latency_ms': float('nan')}, {'latency_ms': -1}, {'latency_ms': True}, {'latency_ms': 'x'},
])
def test_bad_fields_400(client, over):
    assert client.post('/score', json=good(**over)).status_code == 400


def test_train_is_gone(client):
    assert client.post('/train', json={'data': [[1, 2]]}).status_code in (404, 405)


def test_errors_are_json_without_trace(client):
    r = client.get('/nope')
    assert r.status_code == 404 and r.is_json
    assert 'Traceback' not in r.get_data(as_text=True)


@pytest.mark.parametrize('name', ['bad name', 'a' * 101, 'a$b', 'a%00b', '..%2f..'])
def test_stats_bad_service_400(client, name):
    r = client.get('/stats/' + name)
    assert r.status_code in (400, 404)  # routing may reject slashes with 404; never 200/500
    if '/' not in name and '%2f' not in name:
        assert r.status_code == 400


def test_stats_bad_service_exact_400(client):
    assert client.get('/stats/' + 'a' * 101).status_code == 400
    assert client.get('/stats/bad$name').status_code == 400


def test_stats_unknown_404_and_does_not_create(client):
    assert client.get('/stats/never-seen').status_code == 404
    assert 'never-seen' not in api.sliding_window.service_stats


def test_stats_after_score(client):
    client.post('/score', json=good())
    r = client.get('/stats/project-1-server')
    assert r.status_code == 200
    assert r.get_json()['total_logs'] == 1


def test_service_cap_evicts_oldest(client, monkeypatch):
    monkeypatch.setattr(api.sliding_window, 'max_services', 3)
    for i in range(5):
        assert client.post('/score', json=good(service=f'svc-{i}')).status_code == 200
    assert len(api.sliding_window.service_stats) == 3
    assert list(api.sliding_window.service_stats) == ['svc-2', 'svc-3', 'svc-4']
    assert client.get('/stats/svc-0').status_code == 404
    assert client.get('/stats/svc-4').status_code == 200


def test_per_service_events_bounded(client):
    for _ in range(api.MAX_EVENTS_PER_SERVICE + 50):
        api.sliding_window.add_log(good())
    stats = api.sliding_window.service_stats['project-1-server']
    assert len(stats['counts']) == api.MAX_EVENTS_PER_SERVICE
