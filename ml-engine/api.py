"""
ML Engine API Server
Provides real-time anomaly detection scoring
"""

from flask import Flask, request, jsonify
import joblib
import numpy as np
from datetime import datetime, timedelta
from collections import defaultdict
import threading

app = Flask(__name__)

# Phase 1: Isolation Forest Model
class IsolationForestDetector:
    def __init__(self, model_path='anomaly_model.pkl'):
        try:
            self.model = joblib.load(model_path)
        except:
            # If model doesn't exist, create a simple one
            from sklearn.ensemble import IsolationForest
            self.model = IsolationForest(contamination=0.02, random_state=42)
            # Train on dummy data
            dummy_data = np.random.normal(100, 20, (1000, 2))
            self.model.fit(dummy_data)
            joblib.dump(self.model, model_path)
    
    def extract_features(self, log):
        """Extract numerical features from log"""
        latency = log.get('latency_ms', 0)
        level_score = {'INFO': 0, 'WARN': 1, 'ERROR': 2, 'DEBUG': 0}.get(log.get('level', 'INFO'), 0)
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
    def __init__(self, window_minutes=5):
        self.window_minutes = window_minutes
        self.service_stats = defaultdict(lambda: {
            'errors': [],
            'latencies': [],
            'counts': []
        })
        self.lock = threading.Lock()
    
    def add_log(self, log):
        """Add log to sliding window"""
        service = log.get('service', 'unknown')
        timestamp = datetime.now()
        
        with self.lock:
            stats = self.service_stats[service]
            
            # Add current log
            if log.get('level') == 'ERROR':
                stats['errors'].append(timestamp)
            
            if log.get('latency_ms'):
                stats['latencies'].append((timestamp, log['latency_ms']))
            
            stats['counts'].append(timestamp)
            
            # Clean old data
            cutoff = timestamp - timedelta(minutes=self.window_minutes)
            stats['errors'] = [t for t in stats['errors'] if t > cutoff]
            stats['latencies'] = [(t, l) for t, l in stats['latencies'] if t > cutoff]
            stats['counts'] = [t for t in stats['counts'] if t > cutoff]
    
    def detect_anomalies(self, log):
        """Detect anomalies based on sliding window stats"""
        service = log.get('service', 'unknown')
        
        with self.lock:
            stats = self.service_stats[service]
            
            total_logs = len(stats['counts'])
            error_count = len(stats['errors'])
            
            if total_logs == 0:
                return {'is_anomaly': False, 'anomaly_score': 0, 'method': 'sliding_window'}
            
            # Calculate metrics
            error_rate = error_count / total_logs if total_logs > 0 else 0
            
            # Calculate latency stats
            if stats['latencies']:
                latencies = [l for _, l in stats['latencies']]
                avg_latency = np.mean(latencies)
                std_latency = np.std(latencies)
                current_latency = log.get('latency_ms', 0)
                
                # Z-score for latency
                if std_latency > 0:
                    latency_zscore = abs((current_latency - avg_latency) / std_latency)
                else:
                    latency_zscore = 0
            else:
                latency_zscore = 0
            
            # Anomaly scoring
            score = 0
            
            # High error rate
            if error_rate > 0.3:
                score += 0.4
            
            # Latency spike (Z-score > 3)
            if latency_zscore > 3:
                score += 0.4
            
            # Sudden traffic spike
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

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'service': 'ml-engine'})

@app.route('/score', methods=['POST'])
def score():
    """
    Score a log for anomalies
    POST /score
    Body: {
        "service": "payment-service",
        "level": "ERROR",
        "message": "...",
        "latency_ms": 1500
    }
    """
    try:
        log = request.json
        
        if not log:
            return jsonify({'error': 'No log data provided'}), 400
        
        # Phase 1: Isolation Forest
        if_result = isolation_forest.predict(log)
        
        # Phase 2: Sliding Window
        sliding_window.add_log(log)
        sw_result = sliding_window.detect_anomalies(log)
        
        # Combine results (weighted average)
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
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/stats/<service>', methods=['GET'])
def get_service_stats(service):
    """Get sliding window stats for a service"""
    with sliding_window.lock:
        stats = sliding_window.service_stats.get(service)
        
        if not stats:
            return jsonify({'error': 'Service not found'}), 404
        
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

@app.route('/train', methods=['POST'])
def train():
    """
    Retrain the model with new data
    POST /train
    Body: {
        "data": [[latency, level_score], ...]
    }
    """
    try:
        data = request.json.get('data')
        
        if not data:
            return jsonify({'error': 'No training data provided'}), 400
        
        from sklearn.ensemble import IsolationForest
        model = IsolationForest(contamination=0.02, random_state=42)
        model.fit(np.array(data))
        
        joblib.dump(model, 'anomaly_model.pkl')
        
        # Reload model
        global isolation_forest
        isolation_forest = IsolationForestDetector()
        
        return jsonify({'status': 'success', 'message': 'Model retrained'})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("🚀 ML Engine API starting...")
    print("📊 Phase 1: Isolation Forest - ACTIVE")
    print("📈 Phase 2: Sliding Window Stats - ACTIVE")
    print("🔮 Phase 3: Advanced ML - Coming Soon")
    app.run(host='0.0.0.0', port=5000, debug=False)
