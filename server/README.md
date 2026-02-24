# Gang Sheet App - Server

Backend server for the Gang Sheet design application.

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL database
- Cloudflare R2 account (for image storage)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.env` file:**
   ```bash
   cp .env.example .env
   ```

3. **Configure environment variables:**
   Edit `.env` and fill in:
   - `DATABASE_URL` - Your PostgreSQL connection string (REQUIRED)
   - `R2_ENDPOINT` - Cloudflare R2 endpoint URL
   - `R2_BUCKET_NAME` - Your R2 bucket name
   - `R2_ACCESS_KEY` - R2 access key ID
   - `R2_SECRET_KEY` - R2 secret access key
   - `R2_PUBLIC_URL` - Public URL for accessing uploaded images
   - `PORT` - Server port (optional, defaults to 3001)

4. **Set up the database:**
   Create a PostgreSQL database and table:
   ```sql
   CREATE TABLE designs (
     id VARCHAR(255) PRIMARY KEY,
     data JSONB NOT NULL
   );
   ```

## Running the Server

```bash
npm start
```

The server will start on `http://localhost:3001` (or the port specified in `.env`).

## API Endpoints

- `POST /api/upload` - Upload an image (returns thumbnail and high-res URLs)
- `POST /api/designs` - Save a design
- `GET /api/designs/:id` - Retrieve a saved design
- `POST /api/export` - Generate high-resolution PNG export

## Notes

- The server requires `DATABASE_URL` to start
- Image uploads require Cloudflare R2 configuration
- The export endpoint generates 300 DPI images using Konva
