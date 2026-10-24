"""
ML Engine API Server
Shadow-only anomaly scoring (CLAUDE.md rule 5, D4/D32). Not exposed publicly: only the processor calls it.
"""

import math
import os
import re
import tempfile
import threading
from collections import OrderedDict, deque
from datetime import datetime, timedelta

import joblib
import numpy as np
from flask import Flask, jsonify, request

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024  # bytes; checked by Flask before the body is read

# One place for the model, shared with train_model.py and predict.py. In the container this is the
# /app/models volume (WORKDIR is /app).
MODEL_DIR = os.environ.get('MODEL_DIR', 'models')
MODEL_PATH = os.path.join(MODEL_DIR, 'anomaly_model.pkl')

MAX_SERVICE_LEN = 100
MAX_MESSAGE_LEN = 1000
MAX_TRACKED_SERVICES = 1000     # bounds memory against many distinct service names
MAX_EVENTS_PER_SERVICE = 2000   # bounds memory against a flood for one service
LEVELS = {'DEBUG', 'INFO', 'WARN', 'WARNING', 'ERROR', 'FATAL', 'CRITICAL'}
LEVEL_SCORES = {'INFO': 0, 'DEBUG': 0, 'WARN': 1, 'WARNING': 1, 'ERROR': 2, 'FATAL': 2, 'CRITICAL': 2}
SERVICE_RE = re.compile(r'^[A-Za-z0-9._-]{1,100}$')
ALLOWED_FIELDS = {'service', 'level', 'message', 'latency_ms'}


# Phase 1: Isolation Forest Model
class IsolationForestDetector:
    def __init__(self, model_path=MODEL_PATH):
        try:
            self.model = joblib.load(model_path)
        except Exception:
            # No usable model yet: build a placeholder one (synthetic data, shadow-only).
            from sklearn.ensemble import IsolationForest
            self.model = IsolationForest(contamination=0.02, random_state=42)
            rng = np.random.RandomState(42)
            self.model.fit(rng.normal(100, 20, (1000, 2)))
            self._try_save(model_path)

    def _try_save(self, model_path):
        # Best effort and atomic, so a read-only or racing start never leaves a half-written file.
        try:
            os.makedirs(os.path.dirname(model_path) or '.', exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(model_path) or '.')
            os.close(fd)
            joblib.dump(self.model, tmp)
            os.replace(tmp, model_path)
        except OSError:
            pass

    def extract_features(self, log):
        """Extract numerical features from log"""
        latency = log.get('latency_ms', 0)
        level_score = LEVEL_SCORES.get(log.get('level', 'INFO'), 0)
        return np.array([[latency, level_score]])

    def predict(self, log):
        """Predict if log is anomalous"""
        features = self.extract_features(log)
        prediction = self.model.predict(features)
        score = self.model.score_samples(features)

        # Normalize score to 0-1 range
        normalized_score = max(0, min(1, -score[0] / 10))

        return {
            'is_anomaly': bool(prediction[0] == -1),
            'anomaly_score': float(normalized_score),
            'method': 'isolation_forest'
        }

# Phase 2: Real-Time Sliding Window Stats
class SlidingWindowDetector:
    def __init__(self, window_minutes=5, max_services=MAX_TRACKED_SERVICES):
        self.window_minutes = window_minutes
        self.max_services = max_services
        # Insertion/recency ordered: the least recently used service is evicted first.
        self.service_stats = OrderedDict()
        self.lock = threading.Lock()

    def _new_stats(self):
        return {
            'errors': deque(maxlen=MAX_EVENTS_PER_SERVICE),
            'latencies': deque(maxlen=MAX_EVENTS_PER_SERVICE),
            'counts': deque(maxlen=MAX_EVENTS_PER_SERVICE),
        }

    def _prune(self, stats, cutoff):
        while stats['errors'] and stats['errors'][0] <= cutoff:
            stats['errors'].popleft()
        while stats['latencies'] and stats['latencies'][0][0] <= cutoff:
            stats['latencies'].popleft()
        while stats['counts'] and stats['counts'][0] <= cutoff:
            stats['counts'].popleft()

    def add_log(self, log):
        """Add log to sliding window"""
        service = log['service']
        timestamp = datetime.now()

        with self.lock:
            stats = self.service_stats.get(service)
            if stats is None:
                if len(self.service_stats) >= self.max_services:
                    self.service_stats.popitem(last=False)
                stats = self.service_stats[service] = self._new_stats()
            else:
                self.service_stats.move_to_end(service)

            if log.get('level') in ('ERROR', 'FATAL', 'CRITICAL'):
                stats['errors'].append(timestamp)

            if log.get('latency_ms'):
                stats['latencies'].append((timestamp, log['latency_ms']))

            stats['counts'].append(timestamp)

            self._prune(stats, timestamp - timedelta(minutes=self.window_minutes))

    def detect_anomalies(self, log):
        """Detect anomalies based on sliding window stats"""
        service = log['service']

        with self.lock:
            stats = self.service_stats.get(service)
            if stats is None:
                return {'is_anomaly': False, 'anomaly_score': 0, 'method': 'sliding_window'}

            total_logs = len(stats['counts'])
            error_count = len(stats['errors'])

            if total_logs == 0:
                return {'is_anomaly': False, 'anomaly_score': 0, 'method': 'sliding_window'}

            error_rate = error_count / total_logs

            if stats['latencies']:
                latencies = [l for _, l in stats['latencies']]
                avg_latency = np.mean(latencies)
                std_latency = np.std(latencies)
                current_latency = log.get('latency_ms', 0)

                if std_latency > 0:
                    latency_zscore = float(abs((current_latency - avg_latency) / std_latency))
                else:
                    latency_zscore = 0
            else:
                latency_zscore = 0

            score = 0

            if error_rate > 0.3:
                score += 0.4

            if latency_zscore > 3:
                score += 0.4

            if total_logs > 100:  # More than 100 logs in 5 minutes
                score += 0.2

            is_anomaly = score >= 0.6

            return {
                'is_anomaly': is_anomaly,
                'anomaly_score': min(score, 1.0),
                'method': 'sliding_window',
                'metrics': {
                    'error_rate': error_rate,
                    'latency_zscore': latency_zscore,
                    'total_logs': total_logs
                }
            }

# Initialize detectors
isolation_forest = IsolationForestDetector()
sliding_window = SlidingWindowDetector()


def error(status, message):
    return jsonify({'error': message}), status


@app.errorhandler(400)
def _bad_request(_e):
    return error(400, 'Bad request')

@app.errorhandler(404)
def _not_found(_e):
    return error(404, 'Not found')

@app.errorhandler(405)
def _method_not_allowed(_e):
    return error(405, 'Method not allowed')

@app.errorhandler(413)
def _too_large(_e):
    return error(413, 'Request body too large')

@app.errorhandler(Exception)
def _unexpected(_e):
    # Never leak details or stack traces; gunicorn's log has the traceback.
    app.logger.exception('unhandled error')
    return error(500, 'Internal error')


def validate_log(body):
    """Return (clean_log, None) or (None, error message). Messages never echo input."""
    if not isinstance(body, dict):
        return None, 'Body must be a JSON object'
    if set(body) - ALLOWED_FIELDS:
        return None, 'Unknown field'
    service, level = body.get('service'), body.get('level')
    if not isinstance(service, str) or not SERVICE_RE.match(service):
        return None, 'Invalid service'
    if not isinstance(level, str) or level.upper() not in LEVELS:
        return None, 'Invalid level'
    message = body.get('message', '')
    if not isinstance(message, str) or len(message) > MAX_MESSAGE_LEN:
        return None, 'Invalid message'
    log = {'service': service, 'level': level.upper(), 'message': message}
    if 'latency_ms' in body:
        lat = body['latency_ms']
        if isinstance(lat, bool) or not isinstance(lat, (int, float)) \
                or not math.isfinite(lat) or lat < 0 or lat > 1e9:
            return None, 'Invalid latency_ms'
        log['latency_ms'] = lat
    return log, None


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'service': 'ml-engine'})


@app.route('/score', methods=['POST'])
def score():
    """
    Score a log for anomalies
    POST /score
    Body: {"service": "...", "level": "ERROR", "message": "...", "latency_ms": 1500 (optional)}
    """
    log, problem = validate_log(request.get_json(silent=True))
    if problem:
        return error(400, problem)

    if_result = isolation_forest.predict(log)

    sliding_window.add_log(log)
    sw_result = sliding_window.detect_anomalies(log)

    combined_score = (if_result['anomaly_score'] * 0.4 +
                      sw_result['anomaly_score'] * 0.6)

    # Lower threshold for better detection (0.25 instead of 0.6)
    is_anomaly = combined_score >= 0.25

    return jsonify({
        'is_anomaly': is_anomaly,
        'anomaly_score': combined_score,
        'methods': {
            'isolation_forest': if_result,
            'sliding_window': sw_result
        }
    })


@app.route('/stats/<service>', methods=['GET'])
def get_service_stats(service):
    """Get sliding window stats for a service"""
    if not SERVICE_RE.match(service):
        return error(400, 'Invalid service')

    with sliding_window.lock:
        stats = sliding_window.service_stats.get(service)

        if not stats:
            return error(404, 'Service not found')

        total_logs = len(stats['counts'])
        error_count = len(stats['errors'])

        latencies = [l for _, l in stats['latencies']]

        return jsonify({
            'service': service,
            'window_minutes': sliding_window.window_minutes,
            'total_logs': total_logs,
            'error_count': error_count,
            'error_rate': error_count / total_logs if total_logs > 0 else 0,
            'avg_latency': float(np.mean(latencies)) if latencies else 0,
            'max_latency': float(np.max(latencies)) if latencies else 0,
            'min_latency': float(np.min(latencies)) if latencies else 0
        })


# Training is offline only (train_model.py). There is deliberately no /train endpoint.

if __name__ == '__main__':
    # Dev only. In the container gunicorn runs this app (see Dockerfile).
    app.run(host='127.0.0.1', port=5000, debug=False)
