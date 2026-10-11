# InsightHub Python SDK

Python client library for sending logs to InsightHub.

## Installation

```bash
pip install -e .
```

## Usage

```python
from insighthub import InsightHubClient

client = InsightHubClient(
    api_url='http://localhost:8000',
    token='dev-token-123',
    service_name='my-service',
    batch_size=10
)

# Log methods
client.info('User logged in', {'userId': 123})
client.warn('High memory usage', {'memory': 85})
client.error('Database connection failed', {'latency_ms': 5000})

# Manual flush
client.flush()
```

## Features

- ✅ Automatic batching
- ✅ Async log sending
- ✅ Retry logic
- ✅ Metadata support
- ✅ Multiple log levels

## Configuration

- **api_url**: InsightHub backend URL
- **token**: Authentication token
- **service_name**: Your service identifier
- **batch_size**: Logs per batch (default: 10)

## Methods

- `info(message, metadata)` - Info level
- `warn(message, metadata)` - Warning level
- `error(message, metadata)` - Error level
- `log(level, message, metadata)` - Custom level
- `flush()` - Send buffered logs immediately
