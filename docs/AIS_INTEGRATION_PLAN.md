# Real AIS Vessel Position Integration Plan

## Goal
Replace generated/seed vessel positions with real AIS data for the 30 tracked vessels across 10 shipping companies.

## Data Sources (Priority Order)

### 1. AISStream.io (Primary - Global)
- **Type**: Free WebSocket streaming
- **URL**: `wss://stream.aisstream.io/v0/stream`
- **Auth**: API key (register via GitHub at aisstream.io)
- **Coverage**: Global AIS data
- **Limit**: Max 50 MMSI per WebSocket connection
- **Our need**: 30 vessels = 1 connection (fits within limit)
- **Message types**: PositionReport, ShipStaticData
- **Cost**: Free (beta, no SLA)

### 2. Digitraffic (Supplementary - Finnish coastal range)
- **Type**: REST API
- **URL**: `https://meri.digitraffic.fi/api/ais/v1/`
- **Auth**: None required
- **Coverage**: Vessels within Finnish AIS receiver range
- **Already implemented**: `scripts/fetch-vessel-positions.ts`
- **Bonus**: Global vessel registry for IMO->MMSI lookup

### 3. Kystverket (Supplementary - Norwegian waters)
- **Type**: REST API (JWT auth)
- **URL**: `https://kystdatahuset.no/ws/api/`
- **Auth**: JWT Bearer token (need to register)
- **Coverage**: Norwegian coastal waters + North Sea
- **Key endpoints**:
  - `POST /api/ais/positions/for-mmsis-time` - Bulk MMSI lookup
  - `GET /api/ais/realtime/geojson` - Current positions
- **Cost**: Free (NLOD license)

---

## Implementation Steps

### Step 1: Fix Vessel IMOs + Populate MMSIs
Several seed IMOs are incorrect (e.g., Front Alta seed=9806089, real=9920772).

**Script**: `scripts/lookup-vessel-mmsi.ts`
- Query Digitraffic vessel list for IMO->MMSI mapping
- For unmatched vessels, use vessel name search
- Update `shipping_vessels` table with correct IMO + MMSI
- Manual fallback list for any remaining gaps

### Step 2: AISStream.io WebSocket Snapshot Script
**Script**: `scripts/fetch-ais-positions.ts`

```
1. Connect to wss://stream.aisstream.io/v0/stream
2. Send subscription: { APIKey, FiltersShipMMSI: [all 30 MMSIs] }
3. Collect PositionReport messages for up to 5 minutes
4. For each vessel with a new position:
   a. Delete old position from shipping_positions
   b. Insert new position with source='aisstream'
5. Disconnect
```

Key fields from PositionReport:
- Latitude, Longitude
- SpeedOverGround (SOG)
- CourseOverGround (COG)
- TrueHeading
- NavigationalStatus (0=under way, 1=at anchor, 5=moored, etc.)
- Timestamp

### Step 3: Kystverket Supplementary (Norwegian Waters)
**Script**: `scripts/fetch-kystverket-ais.ts`

- Register for API access at kystverket.no
- POST to `/api/ais/positions/for-mmsis-time` with our MMSIs
- Only update positions that are newer than what we have
- Good for FRO, HAFNI, FLNG vessels near Norway

### Step 4: Fallback Chain in Positions API
Update `GET /api/shipping/positions` to show data freshness:

```
Priority: AISStream (latest) > Kystverket > Digitraffic > Seed data
- If position < 24h old: show as "LIVE"
- If position 1-7 days old: show as "DELAYED"
- If position > 7 days: show as "STALE" (dim on map)
```

### Step 5: Cron Schedule
```
# Every 4 hours during business hours (UTC)
0 4,8,12,16,20 * * * cd InEqRe_OBX/apps/web && npx tsx scripts/fetch-ais-positions.ts

# Once daily at 03:00 UTC (Kystverket supplement)
0 3 * * * cd InEqRe_OBX/apps/web && npx tsx scripts/fetch-kystverket-ais.ts
```

Or via GitHub Actions (preferred for Vercel deployment).

---

## MMSI Reference (To Be Populated)

| Company | Vessel | IMO (seed) | IMO (real) | MMSI | Status |
|---------|--------|-----------|-----------|------|--------|
| FRO | Front Alta | 9806089 | 9920772 | 538009638 | verified |
| FRO | Front Njord | 9348906 | 9408205 | 538009041 | verified |
| FRO | Front Eminence | 9806091 | TBD | TBD | pending |
| HAFNI | Hafnia Lotte | 9858272 | 9732694 | 249329000 | verified |
| HAFNI | Hafnia Phoenix | 9828143 | 9461702 | 219487000 | verified |
| ... | ... | ... | ... | ... | ... |

**Note**: Many seed IMOs are incorrect. The lookup script will resolve correct IMOs + MMSIs from Digitraffic and web sources.

---

## Environment Variables Needed

```
AISSTREAM_API_KEY=    # From aisstream.io (register via GitHub)
KYSTVERKET_USERNAME=  # From kystverket.no registration
KYSTVERKET_PASSWORD=  # From kystverket.no registration
```

---

## NPM Scripts (to add to apps/web/package.json)

```json
{
  "ais:snapshot": "tsx scripts/fetch-ais-positions.ts",
  "ais:kystverket": "tsx scripts/fetch-kystverket-ais.ts",
  "ais:lookup-mmsi": "tsx scripts/lookup-vessel-mmsi.ts"
}
```

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| AISStream.io downtime (beta) | No position updates | Fallback to Digitraffic + Kystverket |
| Incorrect IMOs in seed data | Can't match vessels | Lookup script with name-based search |
| Vessels outside AIS range | Missing positions | Keep seed positions as fallback |
| Kystverket auth denied | No Norwegian coverage | AISStream.io covers globally |
| Rate limits | Throttled | 4-hourly cron is conservative |
