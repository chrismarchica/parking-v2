/**
 * Precinct-level prediction module for NYC parking tickets.
 * 
 * Predicts expected ticket counts per precinct for a 60-minute window
 * using historical rate by time bucket (day of week + hour).
 */

import { getDb } from '../db';

export interface PrecinctPrediction {
  precinct: string;
  expected_tickets: number;
  score: number;
}

export interface PredictionResult {
  as_of: string;
  window_minutes: number;
  bucket: {
    dow: number;
    hour: number;
  };
  train_days: number;
  rows_used: number;
  predictions: PrecinctPrediction[];
}

export interface PredictPrecinctOptions {
  /** Target datetime for prediction (default: now) */
  at?: Date;
  /** Number of days to look back for training data (default: 60, range: 14-365) */
  trainDays?: number;
  /** Maximum number of precincts to return (default: 20) */
  limit?: number;
}

/**
 * Predicts expected ticket counts per precinct for the next 60-minute window.
 * 
 * Algorithm (Phase 1 Baseline):
 * 1. Compute target bucket from `at` (day of week, hour of day)
 * 2. Look back `trainDays` days for historical data
 * 3. Parse violation_time to extract hour (format: HHMMA or HHMMP)
 * 4. Filter to rows matching (target_dow, target_hour)
 * 5. For each precinct:
 *    - ticket_count = number of rows in bucket
 *    - matching_days = distinct dates in lookback with same dow
 *    - expected_tickets = ticket_count / matching_days
 *    - score = 1 - exp(-expected_tickets)
 * 6. Return top precincts by score
 */
export async function predictPrecinct(
  options: PredictPrecinctOptions = {}
): Promise<PredictionResult> {
  const at = options.at ?? new Date();
  const trainDays = Math.max(14, Math.min(365, options.trainDays ?? 60));
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));

  // Compute target bucket (using UTC for consistency)
  const targetDow = at.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const targetHour = at.getUTCHours();

  // Compute lookback window
  const lookbackStart = new Date(at);
  lookbackStart.setDate(lookbackStart.getDate() - trainDays);
  const lookbackStartStr = lookbackStart.toISOString().split('T')[0];
  const lookbackEndStr = at.toISOString().split('T')[0];

  const db = getDb();

  // SQL query that does all aggregation in the database
  // Uses CTE for readability
  const query = `
    WITH parsed_tickets AS (
      -- Parse violation_time and filter to valid rows within lookback window
      SELECT 
        precinct,
        issue_date,
        violation_time,
        -- Parse hour from violation_time (format: HHMM followed by A or P)
        CASE 
          -- Pattern: 4 digits followed by A or P
          WHEN violation_time ~ '^[0-9]{4}[AP]$' THEN
            CASE 
              -- PM: add 12 unless it's 12xx
              WHEN RIGHT(violation_time, 1) = 'P' AND LEFT(violation_time, 2) != '12' 
                THEN (LEFT(violation_time, 2)::int + 12)
              -- AM: 12xx becomes 0xx
              WHEN RIGHT(violation_time, 1) = 'A' AND LEFT(violation_time, 2) = '12'
                THEN 0
              -- Otherwise just the hour
              ELSE LEFT(violation_time, 2)::int
            END
          ELSE NULL
        END AS parsed_hour
      FROM parking_ticket
      WHERE 
        issue_date >= $1::date
        AND issue_date <= $2::date
        AND precinct IS NOT NULL
        AND precinct != ''
    ),
    filtered_tickets AS (
      -- Filter to target dow and hour
      SELECT 
        precinct,
        issue_date
      FROM parsed_tickets
      WHERE 
        parsed_hour IS NOT NULL
        AND EXTRACT(DOW FROM issue_date) = $3
        AND parsed_hour = $4
    ),
    precinct_stats AS (
      -- Aggregate by precinct
      SELECT 
        precinct,
        COUNT(*) AS ticket_count,
        COUNT(DISTINCT issue_date) AS matching_days
      FROM filtered_tickets
      GROUP BY precinct
    ),
    -- Count distinct dates with target dow in the lookback window
    total_matching_days AS (
      SELECT COUNT(DISTINCT issue_date) AS total_days
      FROM filtered_tickets
    )
    SELECT 
      ps.precinct,
      ps.ticket_count,
      ps.matching_days,
      -- expected_tickets = ticket_count / matching_days (or 0 if no matching days)
      CASE 
        WHEN ps.matching_days > 0 
        THEN ps.ticket_count::float / ps.matching_days
        ELSE 0
      END AS expected_tickets,
      -- score = 1 - exp(-expected_tickets), capped to avoid underflow
      CASE 
        WHEN ps.matching_days > 0 
        THEN 1.0 - EXP(-1.0 * LEAST(ps.ticket_count::float / ps.matching_days, 700))
        ELSE 0
      END AS score,
      (SELECT SUM(ticket_count) FROM precinct_stats) AS rows_used
    FROM precinct_stats ps
    ORDER BY score DESC
    LIMIT $5
  `;

  const result = await db.query(query, [
    lookbackStartStr,
    lookbackEndStr,
    targetDow,
    targetHour,
    limit,
  ]);

  const rowsUsed = result.rows.length > 0 ? parseInt(result.rows[0].rows_used) || 0 : 0;

  const predictions: PrecinctPrediction[] = result.rows.map((row) => ({
    precinct: row.precinct,
    expected_tickets: parseFloat(row.expected_tickets.toFixed(2)),
    score: parseFloat(row.score.toFixed(4)),
  }));

  return {
    as_of: at.toISOString(),
    window_minutes: 60,
    bucket: {
      dow: targetDow,
      hour: targetHour,
    },
    train_days: trainDays,
    rows_used: rowsUsed,
    predictions,
  };
}

