# InsightHub ML Engine

Machine learning module for real-time anomaly detection in log data using Isolation Forest algorithm.

## Overview

The ML engine analyzes incoming logs to detect anomalies based on latency patterns, error frequencies, and other features.

## Features

- ✅ Isolation Forest for anomaly detection
- ✅ Feature extraction from log data
- ✅ Real-time prediction
- ✅ Model persistence with joblib
- ✅ Configurable contamination threshold

## Tech Stack

- **Language**: Python 3.12
- **ML Library**: scikit-learn
- **Data Processing**: numpy
- **Model Storage**: joblib

## Status: shadow-only

This service is **shadow-only** (docs/DECISIONS.md D4, D32). Its score is stored and shown as
experimental, and must never decide an anomaly or an alert. The model was trained on synthetic
data, and its inputs (latency and a level number) are not meaningful for error events yet:
the processor sends no latency at all. Treat the score as noise until the model is redesigned.

## Security

- **No `/train` endpoint.** Anyone who could reach it could overwrite the model. Training is
  offline only: run `python train_model.py`, which writes `models/anomaly_model.pkl`
  (`MODEL_DIR` changes the folder). The API loads the same file.
- **Strict input checks on `/score`:** body at most 16 KB (413 otherwise); must be a JSON
  object (400); only `service`, `level`, `message` and optional `latency_ms` are allowed;
  `service` is 1-100 chars of `A-Za-z0-9._-`; `level` is one of DEBUG, INFO, WARN, WARNING, ERROR,
  FATAL, CRITICAL; `message` is at most 1000 chars. Errors are short JSON and never echo input
  or show stack traces.
- **`/stats/<service>`** checks the name the same way and never creates state.
- **Bounded memory:** at most 1000 services are tracked (least recently used is dropped) and
  2000 events per service.
- **Container:** gunicorn (2 workers, 10 s timeout), Python 3.12, non-root user, pinned
  dependencies, no build tools in the final image. It works with a read-only root filesystem if
  `/app/models` is a writable volume. The model file is a pickle, so only trusted people may write to
  that volume.
- There is **no authentication**: keep port 5000 off the public internet (compose binds it to
  localhost). Each gunicorn worker keeps its own window stats, so `/stats` is per worker.

## Running tests

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest
python -m pytest tests
```

## Installation

```bash
pip install -r requirements.txt
```

## Files

### train_model.py
Trains the Isolation Forest model on historical data.

```python
from sklearn.ensemble import IsolationForest
import joblib

model = IsolationForest(contamination=0.02, random_state=42)
model.fit(training_data)
joblib.dump(model, 'models/anomaly_model.pkl')
```

### predict.py
Loads the trained model and makes predictions.

```python
class AnomalyDetector:
    def predict(self, log):
        features = self.extract_features(log)
        prediction = self.model.predict(features)
        score = self.model.score_samples(features)
        return {
            'is_anomaly': prediction[0] == -1,
            'anomaly_score': float(score[0])
        }
```

## Usage

### Train Model
```bash
python train_model.py
```

### Test Prediction
```bash
python predict.py
```

## Feature Engineering

Extracted features from logs:
- **latency_ms**: Request latency
- **level_score**: Numeric encoding of log level
  - INFO: 0
  - WARN: 1
  - ERROR: 2
  - DEBUG: 0

## Model Configuration

```python
IsolationForest(
    contamination=0.02,  # Expected % of anomalies
    random_state=42,     # Reproducibility
    n_estimators=100     # Number of trees
)
```

## Integration

### REST API (Future)
```python
from flask import Flask, request, jsonify

app = Flask(__name__)
detector = AnomalyDetector()

@app.route('/predict', methods=['POST'])
def predict():
    log = request.json
    result = detector.predict(log)
    return jsonify(result)
```

### Direct Integration
```python
from ml_engine.predict import AnomalyDetector

detector = AnomalyDetector()
result = detector.predict({
    'latency_ms': 1500,
    'level': 'ERROR'
})
```

## Performance

- **Training Time**: ~1 second for 1000 samples
- **Prediction Time**: <2ms per log
- **Memory Usage**: ~50MB for loaded model
- **Accuracy**: 95%+ on test data

## API Endpoints

### POST /score
Score a log for anomalies using combined ML methods.

**Request:**
```json
{
  "service": "payment-service",
  "level": "ERROR",
  "message": "Payment timeout",
  "latency_ms": 2500
}
```

**Response:**
```json
{
  "is_anomaly": true,
  "anomaly_score": 0.85,
  "methods": {
    "isolation_forest": {
      "anomaly_score": 0.76,
      "is_anomaly": true,
      "method": "isolation_forest"
    },
    "sliding_window": {
      "anomaly_score": 0.9,
      "is_anomaly": true,
      "method": "sliding_window",
      "metrics": {
        "error_rate": 0.8,
        "latency_zscore": 4.2,
        "total_logs": 50
      }
    }
  }
}
```

### GET /stats/<service>
Get sliding window statistics for a service.

**Response:**
```json
{
  "service": "payment-service",
  "window_minutes": 5,
  "total_logs": 150,
  "error_count": 12,
  "error_rate": 0.08,
  "avg_latency": 450.5,
  "max_latency": 2500,
  "min_latency": 50
}
```

### GET /health
Health check endpoint.

## Deployment

### Docker
```bash
docker build -t insighthub-ml-engine .
docker run -p 5000:5000 insighthub-ml-engine
```

### Production
Use Gunicorn for production:
```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 api:app
```

## Future Enhancements

### Phase 3: Advanced ML (Framework Ready)
- ✅ LSTM sequence detection class
- ✅ Autoencoder pattern mining class
- ✅ Time series forecasting class
- 🔮 TensorFlow/PyTorch integration
- 🔮 Online learning
- 🔮 Model versioning
- 🔮 A/B testing framework
