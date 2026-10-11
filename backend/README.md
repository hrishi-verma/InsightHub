# InsightHub Backend - Ingestion Service

The backend ingestion service is responsible for receiving logs from client applications, validating them, and publishing them to Kafka for processing.

## Architecture

```
Client → Authentication → Validation → Kafka → Processor → Database
```

## Features

- ✅ RESTful API for log ingestion
- ✅ JWT/Token-based authentication
- ✅ JSON schema validation with Joi
- ✅ Rate limiting (1000 requests/minute)
- ✅ Kafka message queue integration
- ✅ CORS enabled for frontend access
- ✅ PostgreSQL/TimescaleDB integration for querying
- ✅ Health check endpoint

## Tech Stack

- **Runtime**: Node.js 18
- **Framework**: Express.js
- **Message Queue**: Kafka (via kafkajs)
- **Database**: PostgreSQL with pg driver
- **Validation**: Joi
- **Rate Limiting**: express-rate-limit

## API Endpoints

### 1. Ingest Logs
```http
POST /api/logs
Authorization: Bearer <token>
Content-Type: application/json

{
  "service": "payment-service",
  "level": "ERROR",
  "message": "Payment gateway timeout",
  "latency_ms": 1500,
  "userId": 12345
}
```

**Response:**
```json
{
  "status": "queued"
}
```

### 2. Query Logs
```http
GET /api/logs?service=payment-service&level=ERROR&limit=50
Authorization: Bearer <token>
```

**Response:**
```json
{
  "logs": [
    {
      "log_id": "123",
      "service": "payment-service",
      "level": "ERROR",
      "message": "Payment gateway timeout",
      "latency_ms": 1500,
      "created_at": "2025-12-03T15:00:00Z"
    }
  ]
}
```

### 3. Get Statistics
```http
GET /api/logs/stats
Authorization: Bearer <token>
```

**Response:**
```json
{
  "total_logs": "1234",
  "errors": "45",
  "anomalies": "12"
}
```

### 4. Error Trends
```http
GET /api/logs/errors-over-time
Authorization: Bearer <token>
```

**Response:**
```json
{
  "data": [
    {
      "time": "2025-12-03T14:00:00Z",
      "errors": "12"
    }
  ]
}
```

### 5. Latency by Service
```http
GET /api/logs/latency-by-service
Authorization: Bearer <token>
```

**Response:**
```json
{
  "data": [
    {
      "service": "payment-service",
      "latency": "450.5"
    }
  ]
}
```

### 6. Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "ok"
}
```

## Environment Variables

```bash
PORT=8000
KAFKA_BROKER=kafka:9092
KAFKA_TOPIC=logs
SERVICE_TOKEN=dev-token-123
DB_HOST=postgres
DB_PORT=5432
DB_NAME=insighthub
DB_USER=postgres
DB_PASSWORD=password
```

## Log Schema

Required fields:
- `service` (string): Service name
- `level` (string): One of INFO, WARN, ERROR, DEBUG
- `message` (string): Log message

Optional fields:
- `latency_ms` (number): Request latency in milliseconds
- `userId` (number): User ID associated with the log

Auto-added fields:
- `timestamp` (ISO string): Server timestamp when log was received

## Validation Rules

1. **Service**: Required, must be a string
2. **Level**: Required, must be one of: INFO, WARN, ERROR, DEBUG
3. **Message**: Required, must be a string
4. **Latency**: Optional, must be a number
5. **UserId**: Optional, must be a number

## Rate Limiting

- **Window**: 1 minute
- **Max Requests**: 1000 per window
- **Scope**: Per IP address

## Authentication

All API endpoints (except `/health`) require authentication via Bearer token:

```http
Authorization: Bearer dev-token-123
```

## Development

### Install Dependencies
```bash
npm install
```

### Run Locally
```bash
npm run dev
```

### Run in Production
```bash
npm start
```

## Docker

### Build
```bash
docker build -t insighthub-backend .
```

### Run
```bash
docker run -p 8000:8000 \
  -e KAFKA_BROKER=kafka:9092 \
  -e SERVICE_TOKEN=dev-token-123 \
  insighthub-backend
```

## Project Structure

```
backend/
├── src/
│   ├── index.js              # Main application entry
│   ├── routes/
│   │   └── logs.js           # Log routes and handlers
│   ├── middleware/
│   │   ├── auth.js           # Authentication middleware
│   │   └── validation.js     # Request validation
│   └── services/
│       └── kafka.js          # Kafka producer service
├── package.json
├── Dockerfile
└── .env.example
```

## Error Handling

### 400 Bad Request
Invalid log format or missing required fields

### 401 Unauthorized
Missing or invalid authentication token

### 500 Internal Server Error
Failed to publish to Kafka or database error

## Testing

### Send Test Log
```bash
curl -X POST http://localhost:8000/api/logs \
  -H "Authorization: Bearer dev-token-123" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "test-service",
    "level": "INFO",
    "message": "Test log message",
    "latency_ms": 120
  }'
```

### Query Logs
```bash
curl -H "Authorization: Bearer dev-token-123" \
  "http://localhost:8000/api/logs?limit=10"
```

## Performance Considerations

- Kafka producer connection is reused across requests
- Database connection pooling enabled
- Rate limiting prevents abuse
- CORS enabled for frontend integration
- Async/await for non-blocking operations

## Monitoring

Check service health:
```bash
curl http://localhost:8000/health
```

View logs:
```bash
docker logs insighthub-backend-1
```

## Troubleshooting

### Kafka Connection Issues
- Ensure Kafka is running: `docker ps | grep kafka`
- Check Kafka broker address in environment variables
- Verify network connectivity between containers

### Database Connection Issues
- Ensure PostgreSQL is running
- Verify database credentials
- Check if database `insighthub` exists

### Authentication Failures
- Verify SERVICE_TOKEN environment variable matches client token
- Check Authorization header format: `Bearer <token>`
