import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, invalidateCache } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';

export default function PlayerRanksTab({ adminKey, refresh }) {
  const [rankCsvText, setRankCsvText] = useState('');
  const [rankCsvFileName, setRankCsvFileName] = useState('');
  const [rankDraftYear, setRankDraftYear] = useState(2026);
  const [rankPreview, setRankPreview] = useState(null); // { rows, errors }
  const [rankBusy, setRankBusy] = useState(false);
  const [rankResult, setRankResult] = useState(null);

  // Parse a CSV (or TSV) into rank rows. Accepts flexible header names:
  // rank | consensus_rank | overall_rank, name | player | player_name,
  // position | pos, school | team | college, projected_round | round.
  // Returns { rows, errors, headers }.
  function parsePlayerRankCsv(text) {
    const errors = [];
    const rows = [];
    if (!text || !text.trim()) return { rows, errors: ['empty file'], headers: [] };

    // Normalize newlines + strip UTF-8 BOM if present.
    const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = clean.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) return { rows, errors: ['need header + at least one row'], headers: [] };

    // Autodetect delimiter — comma or tab. Prefer tab if it appears more
    // often than comma in the header line.
    const head = lines[0];
    const delim = (head.match(/\t/g) || []).length > (head.match(/,/g) || []).length ? '\t' : ',';

    const splitRow = (line) => {
      // Minimal RFC-4180-ish CSV split supporting double-quoted fields. TSV
      // path is simpler — we just split on tab since tabs don't appear
      // inside exported fields in practice.
      if (delim === '\t') return line.split('\t').map((c) => c.trim());
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { q = false; }
          else { cur += ch; }
        } else if (ch === '"') {
          q = true;
        } else if (ch === ',') {
          out.push(cur.trim()); cur = '';
        } else {
          cur += ch;
        }
      }
      out.push(cur.trim());
      return out;
    };

    const headerCells = splitRow(head).map((h) =>
      h.toLowerCase().replace(/^"|"$/g, '').trim().replace(/[\s-]+/g, '_')
    );
    const findIdx = (aliases) => headerCells.findIndex((h) => aliases.includes(h));
    const idxRank = findIdx(['rank', 'consensus_rank', 'overall_rank', 'overall', 'ovr']);
    const idxName = findIdx(['name', 'player', 'player_name', 'full_name']);
    const idxPos = findIdx(['position', 'pos']);
    const idxSchool = findIdx(['school', 'college', 'team']);
    const idxRound = findIdx(['projected_round', 'proj_round', 'round']);

    if (idxName === -1) errors.push('CSV must have a "name" (or "player") column');
    if (idxRank === -1) errors.push('CSV must have a "rank" (or "consensus_rank") column');
    if (errors.length) return { rows, errors, headers: headerCells };

    for (let i = 1; i < lines.length; i++) {
      const cells = splitRow(lines[i]).map((c) => c.replace(/^"|"$/g, ''));
      const name = (cells[idxName] || '').trim();
      const rankStr = (cells[idxRank] || '').trim();
      const rank = parseInt(rankStr, 10);
      if (!name) { errors.push(`row ${i + 1}: missing name`); continue; }
      if (!Number.isFinite(rank) || rank <= 0) {
        errors.push(`row ${i + 1}: invalid rank "${rankStr}" for ${name}`);
        continue;
      }
      const row = { name, rank };
      if (idxPos !== -1 && cells[idxPos]) row.position = cells[idxPos].trim();
      if (idxSchool !== -1 && cells[idxSchool]) row.school = cells[idxSchool].trim();
      if (idxRound !== -1 && cells[idxRound]) {
        const rd = parseInt(cells[idxRound], 10);
        if (Number.isFinite(rd)) row.projected_round = rd;
      }
      rows.push(row);
    }
    return { rows, errors, headers: headerCells };
  }

  function onRankCsvFile(file) {
    if (!file) return;
    setRankCsvFileName(file.name);
    setRankResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      setRankCsvText(text);
      setRankPreview(parsePlayerRankCsv(text));
    };
    reader.onerror = () => toast.error('Could not read file');
    reader.readAsText(file);
  }

  function previewRankText() {
    setRankPreview(parsePlayerRankCsv(rankCsvText));
    setRankResult(null);
  }

  async function submitPlayerRanks() {
    const preview = rankPreview || parsePlayerRankCsv(rankCsvText);
    setRankPreview(preview);
    if (!preview.rows.length) {
      toast.error('No valid rows to upload');
      return;
    }
    setRankBusy(true);
    const id = toast.loading(`Uploading ${preview.rows.length} ranks…`);
    try {
      const r = await api.bulkImportPlayerRanks(adminKey, preview.rows, {
        draft_year: Number(rankDraftYear) || undefined,
      });
      toast.dismiss(id);
      toast.success(
        `Updated ${r.updated} · inserted ${r.inserted} · unchanged ${r.unchanged}` +
        (r.not_found_count ? ` · ${r.not_found_count} not found` : '')
      );
      setRankResult(r);
      invalidateCache('players');
      refresh?.({ fresh: true });
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setRankBusy(false);
    }
  }

  function clearRankCsv() {
    setRankCsvText('');
    setRankCsvFileName('');
    setRankPreview(null);
    setRankResult(null);
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-text-primary">Upload Player Ranks</h3>
            <p className="text-text-muted text-[11.5px] mt-0.5 leading-relaxed">
              Upload a CSV to upsert <code className="text-accent font-mono">consensus_rank</code> on
              existing players (matched case-insensitive by name). Required columns:{' '}
              <code className="text-accent font-mono">name</code>,{' '}
              <code className="text-accent font-mono">rank</code>. Optional:{' '}
              <code className="text-accent font-mono">position</code>,{' '}
              <code className="text-accent font-mono">school</code>,{' '}
              <code className="text-accent font-mono">projected_round</code>. Rows with a position
              will insert new players when the name isn't found.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="caption">
              Draft Year
              <input
                type="number"
                value={rankDraftYear}
                onChange={(e) => setRankDraftYear(e.target.value)}
                className="ml-2 bg-bg-deep border border-border-focus rounded px-2 py-1 text-sm w-24 tabular"
                aria-label="Draft year"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              onChange={(e) => onRankCsvFile(e.target.files?.[0])}
              className="block text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent/20 file:text-accent hover:file:bg-accent/30 file:cursor-pointer cursor-pointer"
              aria-label="Select CSV file"
            />
          </label>
          {rankCsvFileName && (
            <span className="text-text-muted text-xs truncate max-w-[240px]" title={rankCsvFileName}>
              {rankCsvFileName}
            </span>
          )}
          {(rankCsvText || rankPreview) && (
            <Button size="sm" variant="ghost" onClick={clearRankCsv} disabled={rankBusy}>
              Clear
            </Button>
          )}
        </div>

        <textarea
          value={rankCsvText}
          onChange={(e) => {
            setRankCsvText(e.target.value);
            setRankPreview(null);
            setRankResult(null);
          }}
          placeholder={'rank,name,position,school\n1,Cam Ward,QB,Miami (FL)\n2,Travis Hunter,WR,Colorado'}
          className="w-full bg-bg-deep border border-border-focus rounded px-3 py-2 text-text-primary text-[12px] font-mono h-40 mb-3"
          spellCheck={false}
          aria-label="CSV contents"
        />

        <div className="flex flex-wrap gap-2 mb-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={previewRankText}
            disabled={rankBusy || !rankCsvText.trim()}
          >
            Preview
          </Button>
          <Button
            size="sm"
            onClick={submitPlayerRanks}
            disabled={rankBusy || !rankCsvText.trim() || !!(rankPreview?.errors?.length && !rankPreview?.rows?.length)}
          >
            {rankBusy ? 'Uploading…' : 'Upload Ranks'}
          </Button>
        </div>

        {rankPreview && (
          <div className="border border-border-subtle rounded p-3 bg-bg-deep/40">
            <div className="flex flex-wrap items-center gap-4 mb-2 text-[12px]">
              <span className="text-text-primary font-semibold">
                Parsed: <span className="text-accent tabular">{rankPreview.rows.length}</span>
              </span>
              {rankPreview.errors.length > 0 && (
                <span className="text-red-400">
                  {rankPreview.errors.length} parse error{rankPreview.errors.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {rankPreview.errors.length > 0 && (
              <ul className="text-[11.5px] text-red-300 list-disc pl-4 mb-2 max-h-32 overflow-y-auto">
                {rankPreview.errors.slice(0, 25).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {rankPreview.errors.length > 25 && (
                  <li className="text-text-muted">…and {rankPreview.errors.length - 25} more</li>
                )}
              </ul>
            )}
            {rankPreview.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left caption">
                      <th className="px-2 py-1 font-display">Rank</th>
                      <th className="px-2 py-1 font-display">Name</th>
                      <th className="px-2 py-1 font-display">Pos</th>
                      <th className="px-2 py-1 font-display">School</th>
                      <th className="px-2 py-1 font-display text-right">Proj Rd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankPreview.rows.slice(0, 20).map((r, i) => (
                      <tr key={i} className="border-t border-border-subtle">
                        <td className="px-2 py-1 tabular">{r.rank}</td>
                        <td className="px-2 py-1 text-text-primary">{r.name}</td>
                        <td className="px-2 py-1">{r.position || <span className="text-text-muted">—</span>}</td>
                        <td className="px-2 py-1 text-text-muted">{r.school || '—'}</td>
                        <td className="px-2 py-1 text-right tabular">
                          {r.projected_round ?? <span className="text-text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rankPreview.rows.length > 20 && (
                  <div className="text-text-muted text-[11px] mt-1">
                    …and {rankPreview.rows.length - 20} more rows
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {rankResult && (
          <div className="mt-3 border border-border-subtle rounded p-3 bg-bg-deep/40 text-[12.5px]">
            <div className="font-semibold text-text-primary mb-2">Upload Result</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
              <div><span className="caption">Received</span><div className="tabular">{rankResult.received}</div></div>
              <div><span className="caption">Updated</span><div className="tabular text-accent">{rankResult.updated}</div></div>
              <div><span className="caption">Inserted</span><div className="tabular text-emerald-400">{rankResult.inserted}</div></div>
              <div><span className="caption">Unchanged</span><div className="tabular text-text-muted">{rankResult.unchanged}</div></div>
              <div><span className="caption">Not Found</span><div className="tabular text-yellow-400">{rankResult.not_found_count}</div></div>
            </div>
            {rankResult.not_found?.length > 0 && (
              <details className="text-[11.5px]">
                <summary className="cursor-pointer text-text-muted hover:text-text-primary">
                  Show first {rankResult.not_found.length} not-found names
                </summary>
                <ul className="list-disc pl-4 mt-1 max-h-40 overflow-y-auto">
                  {rankResult.not_found.map((n, i) => (
                    <li key={i}>{n.name} <span className="text-text-muted">(rank {n.rank})</span></li>
                  ))}
                </ul>
              </details>
            )}
            {rankResult.invalid_count > 0 && (
              <div className="text-red-400 mt-1">
                {rankResult.invalid_count} invalid rows rejected by the server.
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
