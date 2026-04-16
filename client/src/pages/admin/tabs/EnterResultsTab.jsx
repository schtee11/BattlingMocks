import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api, invalidateCache } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { PositionBadge } from '../../../components/ui/Badge.jsx';
import { TeamLogo } from '../../../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../../../components/ui/PlayerHeadshot.jsx';

export default function EnterResultsTab({
  adminKey,
  syncYear,
  setSyncYear,
  players,
  actuals,
  order,
  refresh,
}) {
  const playerSearchRef = useRef(null);

  const [pickNum, setPickNum] = useState(1);
  const [pickQuery, setPickQuery] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerOpen, setPlayerOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const [pollStatus, setPollStatus] = useState(null);
  const [pollInterval, setPollInterval] = useState(20);
  const [syncing, setSyncing] = useState(false);

  // Poll the server-side auto-sync status while the Results tab is visible.
  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const s = await api.pollStatus(adminKey);
        if (!cancelled) setPollStatus(s);
      } catch { /* ignore transient errors */ }
    }
    fetchOnce();
    const id = setInterval(fetchOnce, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [adminKey]);

  async function startPolling() {
    try {
      const s = await api.pollStart(adminKey, { year: syncYear, intervalSec: pollInterval });
      setPollStatus(s);
      toast.success(`Auto-sync ON · every ${s.interval_sec}s`);
    } catch (e) { toast.error(e.message); }
  }
  async function stopPolling() {
    try {
      const s = await api.pollStop(adminKey);
      setPollStatus(s);
      toast('Auto-sync OFF');
    } catch (e) { toast.error(e.message); }
  }

  async function syncPicksFromEspn(dry) {
    if (syncing) return;
    setSyncing(true);
    const id = toast.loading(dry ? 'Previewing picks from ESPN…' : 'Syncing picks from ESPN…');
    try {
      const r = await api.syncPicksFromEspn(adminKey, { year: syncYear, dry });
      toast.dismiss(id);
      // eslint-disable-next-line no-console
      console.log('[sync picks] result', r);
      const head = `Fetched ${r.round1_with_player} · matched ${r.matched}${r.unmatched ? ` · ${r.unmatched} unmatched` : ''}`;
      if (dry) {
        toast(head, { duration: 8000 });
        if (r.unmatched_samples?.length) {
          toast(`Unmatched: ${r.unmatched_samples.map((x) => x.player_name).join(', ')}`, { duration: 10000 });
        }
      } else {
        toast.success(`Saved ${r.saved} picks · scored ${r.scored_mocks} mocks`);
        invalidateCache('actual-picks');
        refresh?.();
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }

  // Exclude players already entered as an actual pick so they don't clutter
  // the typeahead after they've been drafted.
  const draftedPlayerIds = new Set((actuals || []).map((a) => a.player_id));
  const availablePlayers = players.filter((p) => !draftedPlayerIds.has(p.id));
  const filteredPlayers = availablePlayers.filter((p) => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.school || '').toLowerCase().includes(q) ||
      (p.position || '').toLowerCase().includes(q)
    );
  });

  // Picks matching the current typeahead query (or all when query is empty)
  function matchingPicks() {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return order;
    return order.filter((o) =>
      String(o.pick_number).includes(q) ||
      (o.team || '').toLowerCase().includes(q) ||
      (o.team_name || '').toLowerCase().includes(q)
    );
  }

  async function saveActual(e) {
    e.preventDefault();
    if (!selectedPlayer) return toast.error('Select a player');
    try {
      // Team is derived from the draft order — no need for the user to type it.
      const teamForPick = order.find((o) => o.pick_number === Number(pickNum))?.team || null;
      await api.setActualPick(adminKey, {
        pick_number: Number(pickNum),
        player_id: selectedPlayer.id,
        team: teamForPick,
      });
      const savedPick = Number(pickNum);
      toast.success(`Pick ${savedPick} saved · scored live`);
      // Auto-advance to the next pick, reset inputs, refocus search.
      const next = savedPick >= 32 ? savedPick : savedPick + 1;
      setPickNum(next);
      setSelectedPlayer(null);
      setPlayerSearch('');
      refresh?.();
      // Focus the player search so you can just start typing
      setTimeout(() => playerSearchRef.current?.focus(), 0);
    } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-text-primary">One-shot sync from ESPN</h3>
            <p className="text-text-muted text-xs mt-0.5">
              Manual trigger · Round 1 only · preview first, then sync to save + re-score.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] text-text-muted font-display uppercase tracking-wide">Year</label>
            <input
              type="number"
              value={syncYear}
              onChange={(e) => setSyncYear(parseInt(e.target.value, 10) || 2026)}
              className="w-20 bg-bg-deep border border-border-focus rounded px-2 py-1.5 text-text-primary text-sm font-mono"
            />
            <Button size="sm" variant="secondary" onClick={() => syncPicksFromEspn(true)} disabled={syncing}>
              {syncing ? '…' : 'Preview'}
            </Button>
            <Button size="sm" onClick={() => syncPicksFromEspn(false)} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync Picks'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Auto-sync poller */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-text-primary">Draft-night auto-sync</h3>
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-display uppercase tracking-[0.14em] px-2 py-0.5 rounded-full ${
                  pollStatus?.running
                    ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-white/5 text-text-muted ring-1 ring-border-subtle'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${pollStatus?.running ? 'bg-emerald-400 animate-pulse' : 'bg-text-muted'}`} />
                {pollStatus?.running ? 'Running' : 'Off'}
              </span>
            </div>
            <p className="text-text-muted text-xs mt-0.5">
              Server hits ESPN every N seconds, saves new picks, re-scores every mock.
            </p>
            {pollStatus?.running && (
              <div className="text-[11px] text-text-secondary mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-mono tabular">
                <span>year: <span className="text-text-primary">{pollStatus.year}</span></span>
                <span>interval: <span className="text-text-primary">{pollStatus.interval_sec}s</span></span>
                <span>ticks: <span className="text-text-primary">{pollStatus.ticks}</span></span>
                <span>saved this run: <span className="text-gold">{pollStatus.total_saved}</span></span>
                {pollStatus.last_sync_at && (
                  <span>last: <span className="text-text-primary">{new Date(pollStatus.last_sync_at).toLocaleTimeString()}</span></span>
                )}
              </div>
            )}
            {pollStatus?.last_error && (
              <div className="text-[11px] text-red-400 mt-1 break-all">
                last error: {pollStatus.last_error}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] text-text-muted font-display uppercase tracking-wide">Every</label>
            <input
              type="number"
              min={10}
              max={300}
              value={pollInterval}
              onChange={(e) => setPollInterval(parseInt(e.target.value, 10) || 20)}
              disabled={pollStatus?.running}
              className="w-16 bg-bg-deep border border-border-focus rounded px-2 py-1.5 text-text-primary text-sm font-mono disabled:opacity-50"
            />
            <span className="text-[11px] text-text-muted">sec</span>
            {pollStatus?.running ? (
              <Button size="sm" variant="danger" onClick={stopPolling}>Stop</Button>
            ) : (
              <Button size="sm" onClick={startPolling}>Start</Button>
            )}
          </div>
        </div>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5">
        <h3 className="font-semibold text-text-primary mb-3">Enter a pick</h3>
        <form onSubmit={saveActual} className="space-y-3">
          {/* Pick typeahead — type pick #, team abbr, or team name */}
          <div className="relative">
            <input
              value={pickOpen ? pickQuery : (
                (() => {
                  const o = order.find((x) => x.pick_number === Number(pickNum));
                  return o ? `Pick ${o.pick_number} — ${o.team}` : `Pick ${pickNum}`;
                })()
              )}
              onChange={(e) => { setPickQuery(e.target.value); setPickOpen(true); }}
              onFocus={(e) => { setPickQuery(''); setPickOpen(true); e.target.select(); }}
              onBlur={() => setTimeout(() => setPickOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const matches = matchingPicks();
                  if (matches.length > 0) {
                    setPickNum(matches[0].pick_number);
                    setPickQuery('');
                    setPickOpen(false);
                  }
                } else if (e.key === 'Escape') {
                  setPickOpen(false);
                }
              }}
              placeholder="Pick number, team abbr, or team name…"
              autoComplete="off"
              spellCheck={false}
              aria-label="Find pick by number or team"
              aria-expanded={pickOpen}
              className="w-full bg-bg-deep border border-border-focus rounded-lg px-3 py-2 text-text-primary focus:border-accent outline-none"
            />
            {pickOpen && (
              <ul className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-bg-deep border border-border-focus rounded-lg shadow-card divide-y divide-border-subtle">
                {matchingPicks().map((o) => (
                  <li
                    key={o.pick_number}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setPickNum(o.pick_number);
                      setPickQuery('');
                      setPickOpen(false);
                    }}
                    className={`px-3 py-2 hover:bg-accent/10 cursor-pointer flex items-center gap-2 text-sm ${
                      o.pick_number === Number(pickNum) ? 'bg-accent/[0.07]' : ''
                    }`}
                  >
                    <span className="font-mono text-accent w-7 text-right">{o.pick_number}</span>
                    <TeamLogo abbr={o.team} size="xs" />
                    <span className="font-display font-semibold text-text-primary w-10">{o.team}</span>
                    <span className="text-text-secondary truncate">{o.team_name}</span>
                  </li>
                ))}
                {matchingPicks().length === 0 && (
                  <li className="px-3 py-3 text-text-muted text-sm text-center">No matches</li>
                )}
              </ul>
            )}
          </div>
          {/* Player typeahead — rank-ordered, excludes drafted, opens on focus */}
          <div className="relative">
            <input
              ref={playerSearchRef}
              value={playerSearch}
              onChange={(e) => {
                setPlayerSearch(e.target.value);
                setSelectedPlayer(null);
                setPlayerOpen(true);
              }}
              onFocus={(e) => {
                setPlayerOpen(true);
                // If a player is already selected, clear search so the full list shows again
                if (selectedPlayer) { setPlayerSearch(''); setSelectedPlayer(null); }
                e.target.select?.();
              }}
              onBlur={() => setTimeout(() => setPlayerOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (filteredPlayers.length > 0) {
                    const first = filteredPlayers[0];
                    setSelectedPlayer(first);
                    setPlayerSearch(first.name);
                    setPlayerOpen(false);
                  }
                } else if (e.key === 'Escape') {
                  setPlayerOpen(false);
                }
              }}
              placeholder="Search player by name, school, or position…"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search prospect to assign to this pick"
              aria-expanded={playerOpen}
              className="w-full bg-bg-deep border border-border-focus rounded-lg px-3 py-2 text-text-primary focus:border-accent outline-none"
            />
            {playerOpen && (
              <ul className="absolute z-20 left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-bg-deep border border-border-focus rounded-lg shadow-card divide-y divide-border-subtle">
                {filteredPlayers.length === 0 ? (
                  <li className="px-3 py-3 text-text-muted text-sm text-center">
                    {availablePlayers.length === 0 ? 'All prospects drafted' : 'No matches'}
                  </li>
                ) : (
                  filteredPlayers.slice(0, 50).map((p) => (
                    <li
                      key={p.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelectedPlayer(p);
                        setPlayerSearch(p.name);
                        setPlayerOpen(false);
                      }}
                      className="px-3 py-2 hover:bg-accent/10 cursor-pointer flex items-center gap-2.5 text-sm"
                    >
                      <span className="font-mono text-text-muted w-7 text-right text-[11px]">
                        {p.rank ?? ''}
                      </span>
                      <PlayerHeadshot
                        url={p.headshot_url}
                        name={p.name}
                        position={p.position}
                        size="xs"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-text-primary truncate">{p.name}</div>
                        <div className="text-[10.5px] text-text-muted truncate">{p.school}</div>
                      </div>
                      <PositionBadge position={p.position} />
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          {selectedPlayer && (
            <div className="text-sm text-text-secondary flex items-center gap-2">
              <PlayerHeadshot
                url={selectedPlayer.headshot_url}
                name={selectedPlayer.name}
                position={selectedPlayer.position}
                size="xs"
              />
              <span>
                <span className="text-text-primary">{selectedPlayer.name}</span>
                {' · '}
                <span className="text-text-muted">
                  {order.find((o) => o.pick_number === Number(pickNum))?.team || '—'}
                </span>
              </span>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={!selectedPlayer}>Save Pick</Button>
        </form>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold text-text-primary mb-3">Entered ({actuals.length}/32)</h3>
        <ul className="space-y-1 max-h-[55vh] overflow-y-auto">
          {actuals.map((a) => (
            <li key={a.pick_number} className="flex items-center gap-2 py-1.5 border-b border-border-subtle">
              <span className="font-mono text-accent w-7 text-sm">{a.pick_number}</span>
              <TeamLogo abbr={a.team} size="xs" />
              <PlayerHeadshot url={a.headshot_url} name={a.name} position={a.position} size="xs" />
              <span className="text-text-primary text-sm flex-1 truncate">{a.name}</span>
              <PositionBadge position={a.position} />
              <span className="text-text-muted text-xs w-10 text-right">{a.team}</span>
            </li>
          ))}
          {actuals.length === 0 && <li className="text-text-muted text-sm">No picks entered yet.</li>}
        </ul>
      </Card>
      </div>
    </div>
  );
}
