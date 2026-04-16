import { useState } from 'react';
import toast from 'react-hot-toast';
import { loadSlots, saveSlot, updateSlot, deleteSlot, MAX_SLOTS } from '../lib/predictionSlots.js';

// Modal for managing saved prediction-mode mocks. Renders a compact
// "save current" section at the top and a scrollable list of saved slots
// below with Load / Overwrite / Delete actions.
export function PredictionSlotsModal({ currentPicks, currentConfidentSlots, currentDraftOrder, filledCount, onLoad, onClose }) {
  const [slots, setSlots] = useState(loadSlots);
  const [newName, setNewName] = useState(`Mock ${slots.length + 1}`);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const canSave = filledCount > 0 && slots.length < MAX_SLOTS;

  function handleSave() {
    const name = newName.trim() || `Mock ${slots.length + 1}`;
    saveSlot({
      name,
      picks: currentPicks,
      confidentSlots: currentConfidentSlots,
      draftOrder: currentDraftOrder,
    });
    setSlots(loadSlots());
    toast.success(`Saved "${name}"`);
    setNewName(`Mock ${slots.length + 2}`);
  }

  function handleOverwrite(slot) {
    updateSlot(slot.id, {
      picks: currentPicks,
      confidentSlots: currentConfidentSlots,
      draftOrder: currentDraftOrder,
    });
    setSlots(loadSlots());
    toast.success(`Updated "${slot.name}"`);
  }

  function handleDelete(id) {
    deleteSlot(id);
    setSlots(loadSlots());
    setConfirmDeleteId(null);
    toast.success('Deleted');
  }

  function handleLoad(slot) {
    onLoad({
      picks: slot.picks || {},
      confidentSlots: new Set(slot.confidentSlots || []),
      draftOrder: slot.draftOrder || [],
    });
    toast.success(`Loaded "${slot.name}"`);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-20 pb-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border-subtle bg-bg-deep flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(80vh, calc(100dvh - 6rem))' }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-3 border-b border-border-subtle flex items-center justify-between">
          <div>
            <h2 className="font-display text-[14px] font-bold uppercase tracking-[0.1em] text-text-primary">
              Saved Predictions
            </h2>
            <p className="text-[10px] text-text-muted">{slots.length}/{MAX_SLOTS} slots used</p>
          </div>
          <button
            onClick={onClose}
            className="font-display text-[11px] uppercase tracking-wider text-text-muted hover:text-text-primary transition px-2 py-1"
          >
            Close
          </button>
        </div>

        {/* Save current section */}
        <div className="shrink-0 px-5 py-3 border-b border-border-subtle bg-bg-surface/20">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name this mock"
              maxLength={40}
              className="flex-1 min-w-0 text-[12px] bg-bg-surface border border-border-subtle rounded-md px-2.5 py-1.5 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition"
            />
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em] bg-accent text-bg-deep rounded-md px-3 py-1.5 hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
          {filledCount === 0 && (
            <p className="text-[10px] text-text-muted mt-1">Make at least one pick to save.</p>
          )}
          {slots.length >= MAX_SLOTS && (
            <p className="text-[10px] text-gold mt-1">Max {MAX_SLOTS} slots — delete one to save a new mock.</p>
          )}
        </div>

        {/* Slot list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {slots.length === 0 ? (
            <div className="px-5 py-8 text-center text-[11px] text-text-muted">
              No saved predictions yet.
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {slots.map((slot) => {
                const pickCount = Object.keys(slot.picks || {}).length;
                const date = new Date(slot.savedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                });
                return (
                  <div key={slot.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-[12px] font-semibold text-text-primary truncate">
                        {slot.name}
                      </div>
                      <div className="text-[10px] text-text-muted">
                        {pickCount}/32 picks · {date}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleLoad(slot)}
                        className="font-display text-[9px] font-bold uppercase tracking-wider text-accent border border-accent/30 rounded px-2 py-1 hover:bg-accent/10 transition"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleOverwrite(slot)}
                        disabled={filledCount === 0}
                        title="Overwrite with current picks"
                        className="font-display text-[9px] font-bold uppercase tracking-wider text-text-secondary border border-border-subtle rounded px-2 py-1 hover:border-border-focus transition disabled:opacity-30"
                      >
                        Update
                      </button>
                      {confirmDeleteId === slot.id ? (
                        <button
                          onClick={() => handleDelete(slot.id)}
                          className="font-display text-[9px] font-bold uppercase tracking-wider text-red-400 border border-red-400/40 rounded px-2 py-1 hover:bg-red-400/10 transition"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(slot.id)}
                          className="font-display text-[9px] font-bold uppercase tracking-wider text-text-muted border border-border-subtle rounded px-2 py-1 hover:text-red-400 hover:border-red-400/40 transition"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
