import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, invalidateCache } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { Modal } from '../../../components/ui/Modal.jsx';
import { PositionBadge } from '../../../components/ui/Badge.jsx';
import { PlayerHeadshot } from '../../../components/ui/PlayerHeadshot.jsx';

export default function ProspectsTab({ adminKey, syncYear, players, refresh }) {
  const [newP, setNewP] = useState({ name: '', position: '', school: '' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [fetchingHeadshots, setFetchingHeadshots] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportBusy, setBulkImportBusy] = useState(false);
  const [syncProspectsBusy, setSyncProspectsBusy] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');

  const filteredPlayers = players.filter((p) => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.school || '').toLowerCase().includes(q) ||
      (p.position || '').toLowerCase().includes(q)
    );
  });

  async function addPlayer(e) {
    e.preventDefault();
    try {
      await api.addPlayer(adminKey, newP);
      invalidateCache('players');
      setNewP({ name: '', position: '', school: '' });
      toast.success('Added');
      refresh?.({ fresh: true });
    } catch (e) { toast.error(e.message); }
  }

  async function deletePlayer(id) {
    try {
      await api.deletePlayer(adminKey, id);
      invalidateCache('players');
      toast.success('Deleted');
      setConfirmDelete(null);
      refresh?.({ fresh: true });
    } catch (e) { toast.error(e.message); }
  }

  async function setPlayerHeadshot(id, url) {
    try {
      await api.updatePlayer(adminKey, id, { headshot_url: url || null });
      invalidateCache('players');
      toast.success('Headshot saved');
      refresh?.({ fresh: true });
    } catch (e) { toast.error(e.message); }
  }

  async function fetchHeadshots(overwrite = false) {
    if (fetchingHeadshots) return;
    setFetchingHeadshots(true);
    const id = toast.loading(overwrite ? 'Refetching all from ESPN…' : 'Fetching missing headshots from ESPN…');
    try {
      const r = await api.fetchHeadshots(adminKey, { overwrite });
      toast.dismiss(id);
      toast.success(`Scanned ${r.scanned} · updated ${r.updated} · missed ${r.failed}`, { duration: 5000 });
      // Force fresh fetch so the new headshots actually appear in the UI
      refresh?.({ fresh: true });
      if (r.samples?.length) {
        // Log sample URLs so you can click them in the devtools console to verify
        // eslint-disable-next-line no-console
        console.log('[fetch-headshots] sample saved URLs:', r.samples);
        toast(`Sample: ${r.samples[0].name} → ${r.samples[0].url}`, { duration: 10000 });
      }
      invalidateCache('players');
      refresh?.();
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setFetchingHeadshots(false);
    }
  }

  async function importProspects() {
    const id = toast.loading('Importing prospects from seed…');
    try {
      const r = await api.importProspects(adminKey);
      invalidateCache('players');
      toast.dismiss(id);
      toast.success(`Added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}`);
      refresh?.({ fresh: true });
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    }
  }

  async function syncProspectsFromEspn(dry = false) {
    if (syncProspectsBusy) return;
    setSyncProspectsBusy(true);
    const id = toast.loading(dry ? 'Previewing prospects from ESPN…' : 'Syncing prospects from ESPN…');
    try {
      const r = await api.syncProspectsFromEspn(adminKey, { year: syncYear, limit: 400, dry });
      toast.dismiss(id);
      // eslint-disable-next-line no-console
      console.log('[sync prospects] result', r);
      if (dry) {
        toast(`Preview: ${r.fetched} prospects · first=${r.samples?.[0]?.name}`, { duration: 10000 });
      } else {
        toast.success(`Added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}`);
        invalidateCache('players');
        refresh?.({ fresh: true });
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSyncProspectsBusy(false);
    }
  }

  async function submitBulkImport() {
    setBulkImportBusy(true);
    try {
      let parsed;
      try {
        parsed = JSON.parse(bulkImportText);
      } catch {
        throw new Error('Invalid JSON — paste a JSON array of { name, position, school?, headshot_url? }');
      }
      const prospects = Array.isArray(parsed) ? parsed : parsed.prospects;
      if (!Array.isArray(prospects)) {
        throw new Error('Expected an array of prospects');
      }
      const r = await api.bulkImportProspects(adminKey, prospects);
      toast.success(`Received ${r.received} · added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}${r.invalid_count ? ` · ${r.invalid_count} invalid` : ''}`);
      invalidateCache('players');
      setBulkImportText('');
      setBulkImportOpen(false);
      refresh?.({ fresh: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBulkImportBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-text-primary">Prospects ({players.length})</h3>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => syncProspectsFromEspn(false)}
              disabled={syncProspectsBusy}
              title="Pull the draft prospect list from ESPN (up to 400)"
            >
              {syncProspectsBusy ? 'Syncing…' : 'Sync Prospects from ESPN'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => syncProspectsFromEspn(true)}
              disabled={syncProspectsBusy}
              title="Dry-run preview — see what ESPN returns without writing"
            >
              Preview
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkImportOpen(true)}>
              Paste JSON
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fetchHeadshots(false)}
              disabled={fetchingHeadshots}
              title="Batch-fetch headshots for prospects without one"
            >
              {fetchingHeadshots ? 'Fetching…' : 'Headshots'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (window.confirm('Re-query ESPN for ALL prospects (overwrites existing headshots)?')) {
                  fetchHeadshots(true);
                }
              }}
              disabled={fetchingHeadshots}
              title="Re-query ESPN for every prospect and overwrite"
            >
              Refetch
            </Button>
            <Button size="sm" variant="secondary" onClick={importProspects}>Import JSON file</Button>
          </div>
        </div>
        <form onSubmit={addPlayer} className="grid md:grid-cols-4 gap-2 mb-4">
          <input
            required
            value={newP.name}
            onChange={(e) => setNewP({ ...newP, name: e.target.value })}
            placeholder="Name"
            aria-label="Prospect name"
            className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm md:col-span-2"
          />
          <input
            required
            value={newP.position}
            onChange={(e) => setNewP({ ...newP, position: e.target.value.toUpperCase() })}
            placeholder="Pos"
            aria-label="Prospect position"
            className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm uppercase"
          />
          <input
            value={newP.school}
            onChange={(e) => setNewP({ ...newP, school: e.target.value })}
            placeholder="School"
            aria-label="Prospect school (optional)"
            className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm"
          />
          <Button type="submit" className="md:col-span-4">Add Prospect</Button>
        </form>
        <input
          type="search"
          value={playerSearch}
          onChange={(e) => setPlayerSearch(e.target.value)}
          placeholder="Search prospects…"
          aria-label="Search prospects"
          autoComplete="off"
          className="w-full bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm mb-2"
        />
        <div className="text-[11px] text-text-muted mb-2">
          Click a headshot to paste a URL (or leave blank to remove).
        </div>
        <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border-subtle">
          {filteredPlayers.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
              <button
                type="button"
                title="Set headshot URL"
                onClick={() => {
                  const url = window.prompt(`Headshot URL for ${p.name}`, p.headshot_url || '');
                  if (url !== null) setPlayerHeadshot(p.id, url.trim());
                }}
                className="rounded-full hover:ring-2 hover:ring-accent/60 transition"
              >
                <PlayerHeadshot url={p.headshot_url} name={p.name} position={p.position} size="xs" />
              </button>
              <span className="text-text-primary flex-1 truncate">{p.name}</span>
              <PositionBadge position={p.position} />
              <span className="text-text-muted truncate w-32 hidden sm:block">{p.school}</span>
              <button onClick={() => setConfirmDelete(p)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete prospect?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deletePlayer(confirmDelete.id)}>Delete</Button>
          </>
        }
      >
        This removes <span className="text-text-primary">{confirmDelete?.name}</span>. Players referenced by
        any submitted mock can't be deleted.
      </Modal>

      <Modal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        title="Bulk Import Prospects"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkImportOpen(false)} disabled={bulkImportBusy}>
              Cancel
            </Button>
            <Button onClick={submitBulkImport} disabled={bulkImportBusy || !bulkImportText.trim()}>
              {bulkImportBusy ? 'Importing…' : 'Import'}
            </Button>
          </>
        }
      >
        <p className="mb-3">
          Paste a JSON array of prospects. Required fields: <code className="text-accent font-mono text-[11px]">name</code>,{' '}
          <code className="text-accent font-mono text-[11px]">position</code>. Optional:{' '}
          <code className="text-accent font-mono text-[11px]">school</code>,{' '}
          <code className="text-accent font-mono text-[11px]">headshot_url</code>.
        </p>
        <p className="mb-3 text-text-muted text-[11px]">
          Existing players (matched case-insensitive by name) get updated. No deletes.
        </p>
        <textarea
          value={bulkImportText}
          onChange={(e) => setBulkImportText(e.target.value)}
          placeholder={'[\n  { "name": "Cam Ward", "position": "QB", "school": "Miami (FL)" },\n  { "name": "Travis Hunter", "position": "WR", "school": "Colorado" }\n]'}
          className="w-full bg-bg-deep border border-border-focus rounded px-3 py-2 text-text-primary text-[12px] font-mono h-48"
          spellCheck={false}
        />
      </Modal>
    </div>
  );
}
