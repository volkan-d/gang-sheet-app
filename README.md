# Gang Sheet App

A design application for creating and exporting high-quality "gang sheets" (image compositions).

## Project Structure

- `client/` - React + TypeScript frontend (Vite)
- `server/` - Express.js backend with PostgreSQL and Cloudflare R2

## Quick Start

### 1. Set Up the Server

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your database and R2 credentials
npm start
```

The server runs on `http://localhost:3001`

### 2. Set Up the Client

```bash
cd client
npm install
npm run dev
```

The client runs on `http://localhost:5173` (or another port if 5173 is taken)

### 3. Access the App

Open your browser to the client URL (usually `http://localhost:5173`)

## Required Setup

### Database
Create a PostgreSQL database and run:
```sql
CREATE TABLE designs (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL
);
```

### Environment Variables
See `server/.env.example` for required variables:
- `DATABASE_URL` (required)
- Cloudflare R2 credentials (required for image uploads)

## Development

- **Server**: `cd server && npm start`
- **Client**: `cd client && npm run dev`

Both need to run simultaneously for the app to work.
