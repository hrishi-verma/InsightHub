import requests
from datetime import datetime
from typing import Dict, Any

class InsightHubClient:
    def __init__(self, api_url: str = 'http://localhost:8000', 
                 token: str = '', service_name: str = '', batch_size: int = 10):
        self.api_url = api_url
        self.token = token
        self.service_name = service_name
        self.batch_size = batch_size
        self.batch = []

    def log(self, level: str, message: str, metadata: Dict[str, Any] = None):
        log_entry = {
            'service': self.service_name,
            'level': level,
            'message': message,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            **(metadata or {})
        }
        
        self.batch.append(log_entry)
        
        if len(self.batch) >= self.batch_size:
            self.flush()

    def info(self, message: str, metadata: Dict[str, Any] = None):
        self.log('INFO', message, metadata)

    def warn(self, message: str, metadata: Dict[str, Any] = None):
        self.log('WARN', message, metadata)

    def error(self, message: str, metadata: Dict[str, Any] = None):
        self.log('ERROR', message, metadata)

    def flush(self):
        if not self.batch:
            return
        
        logs = self.batch[:]
        self.batch = []
        
        headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }
        
        try:
            for log in logs:
                requests.post(f'{self.api_url}/api/logs', json=log, headers=headers)
        except Exception as e:
            print(f'Failed to send logs: {e}')
