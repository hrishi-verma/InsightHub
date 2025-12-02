import joblib
import numpy as np

class AnomalyDetector:
    def __init__(self, model_path='anomaly_model.pkl'):
        self.model = joblib.load(model_path)
    
    def extract_features(self, log):
        """Extract numerical features from log"""
        latency = log.get('latency_ms', 0)
        level_score = {'INFO': 0, 'WARN': 1, 'ERROR': 2, 'DEBUG': 0}.get(log.get('level'), 0)
        
        return np.array([[latency, level_score]])
    
    def predict(self, log):
        """Predict if log is anomalous"""
        features = self.extract_features(log)
        prediction = self.model.predict(features)
        score = self.model.score_samples(features)
        
        return {
            'is_anomaly': prediction[0] == -1,
            'anomaly_score': float(score[0])
        }

if __name__ == '__main__':
    detector = AnomalyDetector()
    test_log = {'latency_ms': 1500, 'level': 'ERROR'}
    result = detector.predict(test_log)
    print(f"Anomaly detection result: {result}")
