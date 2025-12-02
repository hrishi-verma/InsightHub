import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib

def train_anomaly_model():
    """Train Isolation Forest model for anomaly detection"""
    
    # Generate sample training data (replace with real data)
    np.random.seed(42)
    normal_data = np.random.normal(100, 20, (1000, 2))
    
    # Train model
    model = IsolationForest(contamination=0.02, random_state=42)
    model.fit(normal_data)
    
    # Save model
    joblib.dump(model, 'anomaly_model.pkl')
    print("Model trained and saved successfully")

if __name__ == '__main__':
    train_anomaly_model()
