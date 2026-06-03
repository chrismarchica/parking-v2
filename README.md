# NYC Parking Predictor
fsljfnsjlfn
Parking ticket data visualization and prediction for New York City.

**Live:** https://parking-v2-191764898092.us-east4.run.app/

## Overview

Ingests millions of parking ticket records from NYC Open Data, geocodes locations, and displays them on an interactive map. Data spans FY2017-2024.

## Stack

- **Frontend:** Next.js, React, Mapbox GL
- **Database:** Supabase (PostgreSQL + PostGIS)
- **Data Source:** NYC Open Data Socrata API
- **Deployment:** Google Cloud Run

## Setup

### Prerequisites

- Node.js 20+
- Supabase account
- NYC Open Data API token (optional, recommended)

### Installation

```bash
cd my-app
npm install
cp .env.local.example .env.local  # Configure your environment variables
```

### Environment Variables

```
DATABASE_URL=postgresql://...          # Supabase connection pooler URL (port 6543)
NYC_OPEN_DATA_APP_TOKEN=...            # Optional: Socrata API token
NYC_GEOCLIENT_KEY=...                  # Optional: NYC GeoClient API key
```

### Database Setup

Run `init-db/supabase-init.sql` in the Supabase SQL Editor to create tables.

### Data Ingestion

```bash
# Quick test (100K rows per dataset)
npm run ingest:quick

# Full backfill (FY2017-2024, ~10M+ rows)
npm run ingest:backfill

# Incremental sync
npm run ingest:sync

# Check statistics
npm run ingest:stats
```

### Geocoding

```bash
npm run geocode           # Geocode all records without coordinates
npm run geocode:stats     # Show geocoding progress
```

### Development

```bash
npm run dev
```

## Data Sources

| Dataset | ID | Description |
|---------|-----|-------------|
| FY2024 | pvqr-7yc4 | Parking Violations Issued (with addresses) |
| FY2023 | pvda-ns3a | Parking Violations Issued (with addresses) |
| FY2022 | 869v-vr48 | Parking Violations Issued (with addresses) |
| FY2021 | p7t3-5i9s | Parking Violations Issued (with addresses) |
| FY2020 | jt7v-77mi | Parking Violations Issued (with addresses) |
| FY2019 | faiq-9dfq | Parking Violations Issued (with addresses) |
| FY2018 | 9wgk-ev5c | Parking Violations Issued (with addresses) |
| FY2017 | 2bnn-yakx | Parking Violations Issued (with addresses) |
| Open Violations | nc67-uf89 | Open Parking and Camera Violations (with fines) |

## Project Structure

```
parking-v2/
├── my-app/
│   ├── ingest/          # Data ingestion from NYC Open Data
│   ├── scripts/         # Geocoding and utilities
│   ├── lib/             # Shared database utilities
│   └── app/             # Next.js frontend
├── init-db/             # SQL schema files
├── Dockerfile
└── docker-compose.yml   # Local PostgreSQL for development
```

## License

MIT
