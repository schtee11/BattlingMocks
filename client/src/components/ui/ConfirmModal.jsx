import { useState } from 'react';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';

// Standardized confirmation modal used by every destructive action in the
// app. Builds on the base Modal for focus trap / escape / scroll-lock and
// adds a cancel + confirm pair with async handling, so callers don't have
// to plumb busy state into every cancel dialog.
//
// The confirm button can be either destructive (red `danger` variant) or
// primary (for "lock in your mock" style confirmations). Pass busy=true
// externally to show a submitting state if the caller already tracks it.
//
// Usage:
//   <ConfirmModal
//     open={showClear}
//     onClose={() => setShowClear(false)}
//     onConfirm={() => clearAll()}
//     title="Clear all picks?"
//     description="This removes every prospect from your current mock."
//     confirmLabel="Clear all"
//     confirmVariant="danger"
//   />
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  busy: externalBusy,
}) {
  const [internalBusy, setInternalBusy] = useState(false);
  const busy = externalBusy ?? internalBusy;

  async function handleConfirm() {
    if (busy) return;
    try {
      setInternalBusy(true);
      await onConfirm?.();
    } finally {
      setInternalBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      description={description}
      dismissOnBackdrop={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
