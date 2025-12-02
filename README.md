# InsightHub: Real-Time Smart Log Monitoring System

A distributed, real-time log aggregation, monitoring, and anomaly detection platform.

## Project Structure

```
InsightHub/
├── backend/              # Ingestion API service (Node.js)
├── frontend/             # Dashboard (Next.js + Tailwind)
├── ml-engine/            # Anomaly detection ML module (Python)
├── processor-service/    # Stream processor (Node.js)
├── sdk-js/               # JavaScript SDK
├── sdk-python/           # Python SDK
├── can-be-deleted/       # Temporary/experimental files
└── docker-compose.yml    # Docker orchestration
```

## Quick Start

1. Start all services:
```bash
docker-compose up --build
```

2. Access the dashboard:
```
http://localhost:3000
```

3. Send a test log:
```bash
curl -X POST http://localhost:8000/api/logs \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "demo-service",
    "level": "INFO",
    "message": "Test log message",
    "latency_ms": 120
  }'
```

## Development

### Backend (Ingestion Service)
```bash
cd backend
npm install
npm run dev
```

### Frontend (Dashboard)
```bash
cd frontend
npm install
npm run dev
```

### ML Engine
```bash
cd ml-engine
pip install -r requirements.txt
python train_model.py
```

### Processor Service
```bash
cd processor-service
npm install
npm start
```

## Using the SDKs

### JavaScript SDK
```javascript
const InsightHubClient = require('@insighthub/sdk-js');

const client = new InsightHubClient({
  apiUrl: 'http://localhost:8000',
  token: 'dev-token-123',
  serviceName: 'my-service'
});

client.info('User logged in', { userId: 123 });
client.error('Payment failed', { latency_ms: 1500 });
```

### Python SDK
```python
from insighthub import InsightHubClient

client = InsightHubClient(
    api_url='http://localhost:8000',
    token='dev-token-123',
    service_name='my-service'
)

client.info('User logged in', {'userId': 123})
client.error('Payment failed', {'latency_ms': 1500})
```

## License

MIT
