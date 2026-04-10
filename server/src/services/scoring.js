// Idempotent scoring — recalculates total_score for every round1 mock in a
// single query instead of N+1. Designed to run inside an open pg client so
// callers can wrap it in their own transaction.
export async function runScoringOnClient(client) {
  // Compute scores for all round1 mocks in one pass using a CTE, then bulk-
  // update. This replaces the previous per-mock SELECT + UPDATE loop.
  const { rowCount } = await client.query(`
    WITH scores AS (
      SELECT
        mp.mock_id,
        SUM(
          CASE
            WHEN ap.player_id IS NULL THEN 0
            WHEN ap.pick_number = mp.pick_number THEN 15
            WHEN ABS(ap.pick_number - mp.pick_number) <= 5 THEN 8
            ELSE 5
          END
        )::int AS total
      FROM mock_picks mp
      JOIN mocks m ON m.id = mp.mock_id AND m.mock_type = 'round1'
      LEFT JOIN actual_picks ap ON ap.player_id = mp.player_id
      GROUP BY mp.mock_id
    )
    UPDATE mocks
    SET total_score = scores.total
    FROM scores
    WHERE mocks.id = scores.mock_id
  `);
  await client.query('UPDATE draft_settings SET scoring_run_at = NOW() WHERE id = 1');
  return rowCount;
}
