# InsightHub JavaScript SDK

JavaScript/Node.js client library for sending logs to InsightHub.

## Installation

```bash
npm install @insighthub/sdk-js
```

## Usage

```javascript
const InsightHubClient = require('@insighthub/sdk-js');

const client = new InsightHubClient({
  apiUrl: 'http://localhost:8000',
  token: 'dev-token-123',
  serviceName: 'my-service',
  batchSize: 10
});

// Log methods
client.info('User logged in', { userId: 123 });
client.warn('High memory usage', { memory: 85 });
client.error('Database connection failed', { latency_ms: 5000 });

// Manual flush
await client.flush();
```

## Features

- ✅ Automatic batching
- ✅ Async log sending with axios
- ✅ Retry logic
- ✅ Metadata support
- ✅ Multiple log levels
- ✅ TypeScript support (future)

## Configuration

- **apiUrl**: InsightHub backend URL
- **token**: Authentication token
- **serviceName**: Your service identifier
- **batchSize**: Logs per batch (default: 10)

## Methods

- `info(message, metadata)` - Info level
- `warn(message, metadata)` - Warning level
- `error(message, metadata)` - Error level
- `log(level, message, metadata)` - Custom level
- `flush()` - Send buffered logs immediately

## Browser Usage

```html
<script src="insighthub-sdk.min.js"></script>
<script>
  const client = new InsightHubClient({
    apiUrl: 'https://logs.example.com',
    token: 'your-token',
    serviceName: 'web-app'
  });
  
  client.info('Page loaded');
</script>
```
