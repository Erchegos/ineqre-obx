/**
 * Harvest Tracker — Vessel History API
 * GET /api/seafood/harvest-tracker/vessel-history?vesselId=X&days=30
 *
 * Returns position history + trip log + proximity events for a specific vessel.
 * Each position is annotated with nearest farm/slaughterhouse if within range.
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Haversine in nautical miles
function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NEAR_THRESHOLD_NM = 2.0; // annotate positions within 2nm of a farm/slaughterhouse

export async function GET(req: NextRequest) {
  const vesselId = req.nextUrl.searchParams.get("vesselId");
  const days = Math.min(parseInt(req.nextUrl.searchParams.get("days") || "30") || 30, 365);

  if (!vesselId) {
    return NextResponse.json({ error: "vesselId required" }, { status: 400 });
  }

  try {
    // 1. Vessel details
    const vesselRes = await pool.query(
      `SELECT id, vessel_name, imo, mmsi, owner_company, operator_ticker,
              capacity_tonnes::float, vessel_type, built_year, is_active,
              updated_at, created_at
       FROM harvest_vessels WHERE id = $1`,
      [vesselId]
    );
    if (vesselRes.rows.length === 0) {
      return NextResponse.json({ error: "Vessel not found" }, { status: 404 });
    }
    const vessel = vesselRes.rows[0];

    // 2. Position history
    let positions: Array<{
      lat: number; lng: number; timestamp: string;
      speed_knots: number | null; heading: number | null; course: number | null;
      nearFarm?: { name: string; ticker: string | null; distNm: number } | null;
      nearSlaughterhouse?: { name: string; ticker: string; distNm: number } | null;
    }> = [];
    try {
      const posRes = await pool.query(
        `SELECT latitude::float AS lat, longitude::float AS lng,
                speed_knots::float, heading, course::float, timestamp
         FROM harvest_vessel_positions
         WHERE vessel_id = $1 AND timestamp > NOW() - $2::interval
         ORDER BY timestamp ASC`,
        [vesselId, `${days} days`]
      );
      positions = posRes.rows;
    } catch {
      // Table might not exist yet
    }

    // 3. Load farms + slaughterhouses for proximity annotation
    let farms: Array<{ name: string; ticker: string | null; lat: number; lng: number }> = [];
    let slaughterhouses: Array<{ name: string; ticker: string; lat: number; lng: number }> = [];

    if (positions.length > 0) {
      // Only load reference data if we have positions to annotate
      const [farmRes, shRes] = await Promise.all([
        pool.query(
          `SELECT name, ticker, lat::float, lng::float
           FROM seafood_localities WHERE lat IS NOT NULL AND lng IS NOT NULL AND is_active = true`
        ),
        pool.query(
          `SELECT name, ticker, lat::float, lng::float FROM harvest_slaughterhouses WHERE is_active = true`
        ),
      ]);
      farms = farmRes.rows;
      slaughterhouses = shRes.rows;

      // Annotate each position with nearest farm/slaughterhouse
      for (const pos of positions) {
        let nearestFarm: { name: string; ticker: string | null; distNm: number } | null = null;
        let nearestSH: { name: string; ticker: string; distNm: number } | null = null;

        for (const f of farms) {
          const d = haversineNm(pos.lat, pos.lng, f.lat, f.lng);
          if (d < NEAR_THRESHOLD_NM && (!nearestFarm || d < nearestFarm.distNm)) {
            nearestFarm = { name: f.name, ticker: f.ticker, distNm: Math.round(d * 100) / 100 };
          }
        }
        for (const sh of slaughterhouses) {
          const d = haversineNm(pos.lat, pos.lng, sh.lat, sh.lng);
          if (d < NEAR_THRESHOLD_NM && (!nearestSH || d < nearestSH.distNm)) {
            nearestSH = { name: sh.name, ticker: sh.ticker, distNm: Math.round(d * 100) / 100 };
          }
        }

        if (nearestFarm) pos.nearFarm = nearestFarm;
        if (nearestSH) pos.nearSlaughterhouse = nearestSH;
      }
    }

    // 4. Detect visit events from positions (group consecutive near-farm/near-SH positions)
    const visits: Array<{
      type: "farm" | "slaughterhouse";
      name: string;
      ticker: string | null;
      arrivalTime: string;
      departureTime: string;
      durationMinutes: number;
      positionCount: number;
    }> = [];

    let currentVisit: { type: "farm" | "slaughterhouse"; name: string; ticker: string | null; start: string; end: string; count: number } | null = null;

    for (const pos of positions) {
      const near = pos.nearFarm || pos.nearSlaughterhouse;
      const nearType = pos.nearFarm ? "farm" : pos.nearSlaughterhouse ? "slaughterhouse" : null;

      if (near && nearType) {
        if (currentVisit && currentVisit.name === near.name && currentVisit.type === nearType) {
          // Continue existing visit
          currentVisit.end = pos.timestamp;
          currentVisit.count++;
        } else {
          // Close previous visit
          if (currentVisit) {
            const dur = (new Date(currentVisit.end).getTime() - new Date(currentVisit.start).getTime()) / 60000;
            visits.push({
              type: currentVisit.type,
              name: currentVisit.name,
              ticker: currentVisit.ticker,
              arrivalTime: currentVisit.start,
              departureTime: currentVisit.end,
              durationMinutes: Math.round(dur),
              positionCount: currentVisit.count,
            });
          }
          // Start new visit
          currentVisit = { type: nearType, name: near.name, ticker: near.ticker ?? null, start: pos.timestamp, end: pos.timestamp, count: 1 };
        }
      } else {
        // Not near anything — close visit if open
        if (currentVisit) {
          const dur = (new Date(currentVisit.end).getTime() - new Date(currentVisit.start).getTime()) / 60000;
          visits.push({
            type: currentVisit.type,
            name: currentVisit.name,
            ticker: currentVisit.ticker,
            arrivalTime: currentVisit.start,
            departureTime: currentVisit.end,
            durationMinutes: Math.round(dur),
            positionCount: currentVisit.count,
          });
          currentVisit = null;
        }
      }
    }
    // Close final visit
    if (currentVisit) {
      const dur = (new Date(currentVisit.end).getTime() - new Date(currentVisit.start).getTime()) / 60000;
      visits.push({
        type: currentVisit.type,
        name: currentVisit.name,
        ticker: currentVisit.ticker,
        arrivalTime: currentVisit.start,
        departureTime: currentVisit.end,
        durationMinutes: Math.round(dur),
        positionCount: currentVisit.count,
      });
    }

    // 5. Trip log
    const tripsRes = await pool.query(
      `SELECT id, origin_name, origin_ticker, destination_name,
              departure_time, arrival_time, duration_hours::float,
              estimated_volume_tonnes::float, spot_price_at_harvest::float,
              production_area_number, status
       FROM harvest_trips
       WHERE vessel_id = $1 AND departure_time > NOW() - $2::interval
       ORDER BY departure_time DESC
       LIMIT 100`,
      [vesselId, `${days} days`]
    );

    // 6. Trip stats (12 months)
    const statsRes = await pool.query(
      `SELECT
         COUNT(*) AS total_trips,
         SUM(estimated_volume_tonnes)::float AS total_volume,
         AVG(duration_hours)::float AS avg_duration_hours,
         AVG(spot_price_at_harvest)::float AS avg_spot_price
       FROM harvest_trips
       WHERE vessel_id = $1 AND departure_time > NOW() - '365 days'::interval`,
      [vesselId]
    );

    // 7. Current spot price for context
    let currentSpot: number | null = null;
    try {
      const spotRes = await pool.query(
        `SELECT sisalmon_avg::float FROM salmon_spot_weekly ORDER BY report_date DESC LIMIT 1`
      );
      if (spotRes.rows.length > 0) currentSpot = spotRes.rows[0].sisalmon_avg;
    } catch { /* ignore */ }

    return NextResponse.json({
      vessel,
      positions,
      visits,
      trips: tripsRes.rows,
      stats: statsRes.rows[0] || { total_trips: 0, total_volume: null, avg_duration_hours: null, avg_spot_price: null },
      positionCount: positions.length,
      currentSpotPrice: currentSpot,
    });
  } catch (err) {
    console.error("[HARVEST VESSEL HISTORY]", err);
    return NextResponse.json({ error: "Failed to fetch vessel history" }, { status: 500 });
  }
}
