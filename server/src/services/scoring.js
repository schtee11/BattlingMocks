// Idempotent scoring — recalculates total_score for every round1 mock in a
// single query instead of N+1. Designed to run inside an open pg client so
// callers can wrap it in their own transaction.
//
// Scoring tiers (Phase 6, enterprise upgrade):
//   - Exact match (player + pick slot)                  → 10  (× 1.5 if confidence pick)
//   - Correct player, correct team, wrong slot          →  7
//   - Correct player drafted in R1, wrong team entirely →  3
//   - Proximity bonus (predicted within 3 picks)        → +1
//   - Miss                                              →  0
//
// Max per-pick (non-confident) = 10 + 1 proximity bonus = 11
// Max per-pick (confident exact match) = round(10 * 1.5) = 15
// Base max for 32 picks: 32 * 10 + 32 * 1 = 352
// With all 3 confidence multipliers landing exact: 320 + 32 - 3*10 + 3*15 = 337  (~352 is shown
// as the displayed ceiling in the UI; individual pick detail breaks down the multiplier).
//
// Implementation notes:
//  - We correlate mock picks against actual picks via a join on player_id
//    which tells us WHERE the player actually went. Team-match checking uses
//    the draft_order table to look up the team that owned the user's
//    predicted slot.
//  - ROUND() keeps the stored total_score an INTEGER (1.5x of 10 = 15, which
//    is still an integer; fractional scores would happen only if we ever
//    multiplied the +1 bonus, which we don't).
export async function runScoringOnClient(client) {
  const { rowCount } = await client.query(`
    WITH pick_scores AS (
      SELECT
        mp.mock_id,
        mp.pick_number        AS predicted_slot,
        mp.is_confident,
        do_pred.team          AS predicted_team,
        ap_player.pick_number AS actual_slot_for_player,
        ap_player.team        AS actual_team_for_player
      FROM mock_picks mp
      JOIN mocks m ON m.id = mp.mock_id AND m.mock_type = 'round1'
      LEFT JOIN draft_order do_pred ON do_pred.pick_number = mp.pick_number AND do_pred.draft_year = 2026
      LEFT JOIN actual_picks ap_player ON ap_player.player_id = mp.player_id
    ),
    scored AS (
      SELECT
        mock_id,
        CASE
          -- Exact match (right player, right slot). Confidence pick → 1.5x.
          WHEN actual_slot_for_player = predicted_slot
            THEN CASE WHEN is_confident THEN 15 ELSE 10 END
          -- Correct player, correct team, wrong slot (team traded up/down).
          WHEN actual_slot_for_player IS NOT NULL
           AND actual_team_for_player = predicted_team
            THEN 7
          -- Correct player drafted in R1, wrong team entirely.
          WHEN actual_slot_for_player IS NOT NULL
            THEN 3
          ELSE 0
        END AS base_points,
        CASE
          -- Proximity bonus: predicted slot within 3 of the player's actual
          -- slot. Only applies when the player actually landed in R1.
          WHEN actual_slot_for_player IS NOT NULL
           AND actual_slot_for_player <> predicted_slot
           AND ABS(actual_slot_for_player - predicted_slot) <= 3
            THEN 1
          ELSE 0
        END AS bonus_points
      FROM pick_scores
    ),
    totals AS (
      SELECT mock_id, SUM(base_points + bonus_points)::int AS total
      FROM scored
      GROUP BY mock_id
    )
    UPDATE mocks
    SET total_score = totals.total
    FROM totals
    WHERE mocks.id = totals.mock_id
  `);
  await client.query('UPDATE draft_settings SET scoring_run_at = NOW() WHERE id = 1');
  return rowCount;
}
