import os

import numpy as np
from sklearn.ensemble import IsolationForest
import joblib

# Same location the API reads (api.py); override with MODEL_DIR.
MODEL_PATH = os.path.join(os.environ.get('MODEL_DIR', 'models'), 'anomaly_model.pkl')

def train_anomaly_model():
    """Train Isolation Forest model for anomaly detection"""
    
    # Generate sample training data (replace with real data)
    np.random.seed(42)
    normal_data = np.random.normal(100, 20, (1000, 2))
    
    # Train model
    model = IsolationForest(contamination=0.02, random_state=42)
    model.fit(normal_data)
    
    # Save model
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"Model trained and saved to {MODEL_PATH}")

if __name__ == '__main__':
    train_anomaly_model()
