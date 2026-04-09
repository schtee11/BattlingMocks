// Idempotent scoring — recalculates total_score for every mock based on
// current actual_picks. Designed to run inside an open pg client so callers
// can wrap it in their own transaction.
export async function runScoringOnClient(client) {
  const { rows: actuals } = await client.query(
    'SELECT pick_number, player_id FROM actual_picks'
  );
  const actualByPlayer = new Map(actuals.map((a) => [a.player_id, a.pick_number]));

  const { rows: mocks } = await client.query('SELECT id FROM mocks');
  for (const m of mocks) {
    const { rows: picks } = await client.query(
      'SELECT pick_number, player_id FROM mock_picks WHERE mock_id = $1',
      [m.id]
    );
    let total = 0;
    for (const p of picks) {
      const actualSlot = actualByPlayer.get(p.player_id);
      if (actualSlot == null) continue;
      if (actualSlot === p.pick_number) total += 15;
      else if (Math.abs(actualSlot - p.pick_number) <= 5) total += 8;
      else total += 5;
    }
    await client.query('UPDATE mocks SET total_score = $1 WHERE id = $2', [total, m.id]);
  }
  await client.query('UPDATE draft_settings SET scoring_run_at = NOW() WHERE id = 1');
  return mocks.length;
}
