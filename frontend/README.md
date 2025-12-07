# InsightHub Frontend - Dashboard

Modern, real-time log monitoring dashboard built with Next.js 14 and Tailwind CSS.

## Features

- ✅ Real-time dashboard with live statistics
- ✅ Live log streaming with auto-refresh
- ✅ Advanced filtering (service, level, keyword)
- ✅ Analytics with interactive charts
- ✅ Alert management system
- ✅ JWT authentication
- ✅ Responsive design (mobile & desktop)
- ✅ Dark theme UI

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **State Management**: React Hooks
- **Authentication**: JWT (localStorage)
- **API Client**: Fetch API

## Pages

### 1. Login (`/login`)
- Email and password authentication
- JWT token storage
- Auto-redirect to dashboard on success
- Demo credentials displayed

### 2. Dashboard (`/dashboard`)
**Features:**
- Summary cards: Total logs, errors, anomalies
- Line chart: Errors over time
- Bar chart: Average latency by service
- Auto-refresh every 5 seconds
- Trend indicators (↑ ↓)

### 3. Live Logs (`/logs`)
**Features:**
- Real-time log stream (refreshes every 3 seconds)
- Color-coded log levels
- Filters:
  - Service name
  - Log level (INFO/WARN/ERROR/DEBUG)
  - Keyword search
- Auto-scroll toggle
- Displays: timestamp, service, level, message, latency

### 4. Analytics (`/analytics`)
**Features:**
- Time range selector (1h, 24h, 7d, 30d)
- Area chart: Log volume over time
- Line chart: Errors & warnings trend
- Pie chart: Service distribution
- Anomaly detection trend with threshold

### 5. Alerts (`/alerts`)
**Features:**
- Create/Edit/Delete alert rules
- Configure conditions and thresholds
- Enable/Disable alerts
- Notification channels (Slack, Email, Webhook)
- Alert status indicators

## Project Structure

```
frontend/
├── app/
│   ├── layout.js             # Root layout with navbar
│   ├── page.js               # Home (redirects to login/dashboard)
│   ├── globals.css           # Global styles
│   ├── login/
│   │   └── page.js           # Login page
│   ├── dashboard/
│   │   └── page.js           # Dashboard overview
│   ├── logs/
│   │   └── page.js           # Live log stream
│   ├── analytics/
│   │   └── page.js           # Analytics & charts
│   └── alerts/
│       └── page.js           # Alert management
├── components/
│   ├── Navbar.js             # Navigation bar
│   ├── Dashboard.js          # Dashboard cards
│   └── LogStream.js          # Log stream component
├── lib/
│   ├── api.js                # API client utilities
│   └── auth.js               # Authentication utilities
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── next.config.js
└── .env.local
```

## Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Open http://localhost:3000

## Production Build

```bash
npm run build
npm start
```

## Docker

### Build
```bash
docker build -t insighthub-frontend .
```

### Run
```bash
docker run -p 3000:3000 insighthub-frontend
```

## Authentication Flow

1. User visits root `/`
2. Check for token in localStorage
3. If token exists → redirect to `/dashboard`
4. If no token → redirect to `/login`
5. After login → store token → redirect to `/dashboard`
6. Logout → remove token → redirect to `/login`

## API Integration

### Fetch Logs
```javascript
const response = await fetch('http://localhost:8000/api/logs?limit=50', {
  headers: { 
    'Authorization': `Bearer ${token}` 
  }
});
const data = await response.json();
```

### Fetch Statistics
```javascript
const response = await fetch('http://localhost:8000/api/logs/stats', {
  headers: { 
    'Authorization': `Bearer ${token}` 
  }
});
const stats = await response.json();
```

## Components

### Navbar
- Navigation links with active state
- Logout button
- Responsive design

### Dashboard Cards
- Metric display with trends
- Color-coded values
- Percentage changes

### Log Stream
- Real-time updates
- Filter controls
- Auto-scroll functionality
- Color-coded log levels

### Charts (Recharts)
- Line charts for trends
- Bar charts for comparisons
- Pie charts for distribution
- Area charts for volume
- Responsive containers

## Styling

### Tailwind Classes
- Dark theme: `bg-gray-900`, `bg-gray-800`
- Text colors: `text-white`, `text-gray-400`
- Borders: `border-gray-700`
- Buttons: `bg-blue-600 hover:bg-blue-700`

### Log Level Colors
- ERROR: `text-red-500 bg-red-500/10`
- WARN: `text-yellow-500 bg-yellow-500/10`
- INFO: `text-blue-500 bg-blue-500/10`
- DEBUG: `text-gray-500 bg-gray-500/10`

## State Management

Using React Hooks:
- `useState` for component state
- `useEffect` for side effects and data fetching
- `useRouter` for navigation
- `usePathname` for current route

## Auto-Refresh

### Dashboard
- Refreshes every 5 seconds
- Fetches stats, error trends, latency data

### Live Logs
- Refreshes every 3 seconds
- Fetches latest 50 logs
- Maintains scroll position if auto-scroll disabled

## Responsive Design

### Breakpoints
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

### Grid Layouts
- Cards: 1 column (mobile) → 3 columns (desktop)
- Charts: 1 column (mobile) → 2 columns (desktop)

## Testing

### Login
1. Go to http://localhost:3000/login
2. Enter any email/password
3. Click "Sign In"
4. Should redirect to dashboard

### Dashboard
1. Verify stats cards display numbers
2. Check charts render correctly
3. Confirm auto-refresh works

### Live Logs
1. Verify logs appear in list
2. Test filters (service, level, keyword)
3. Toggle auto-scroll
4. Check color coding

## Troubleshooting

### CORS Issues
Ensure backend has CORS enabled:
```javascript
res.header('Access-Control-Allow-Origin', '*');
```

### API Connection Failed
- Check backend is running on port 8000
- Verify API_URL in .env.local
- Check browser console for errors

### Charts Not Rendering
- Ensure Recharts is installed
- Check data format matches chart requirements
- Verify ResponsiveContainer has height

### Authentication Issues
- Clear localStorage: `localStorage.clear()`
- Check token format in API calls
- Verify backend accepts the token

## Performance Optimization

- Server-side rendering with Next.js
- Automatic code splitting
- Image optimization
- CSS purging with Tailwind
- Lazy loading for charts

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Accessibility

- Semantic HTML elements
- ARIA labels where needed
- Keyboard navigation support
- Color contrast compliance
- Focus indicators

## Future Enhancements

- WebSocket for real-time updates
- Export logs to CSV/JSON
- Advanced search with regex
- Custom dashboard layouts
- User preferences storage
- Multi-language support
