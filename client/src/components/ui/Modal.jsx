import { useEffect, useRef } from 'react';

const SIZE_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

// Base modal used by both plain info dialogs and ConfirmModal. Handles:
//   - Escape to close
//   - Body scroll lock while open
//   - Focus return to the element that had focus before the modal opened
//   - Cheap focus trap (Tab / Shift+Tab cycle within the dialog)
//   - Click-outside to dismiss (configurable)
//   - aria-labelledby / aria-describedby wiring for screen readers
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissOnBackdrop = true,
}) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the dialog so Escape and Tab have somewhere to start from.
    // Defer one tick so the element is definitely in the DOM.
    const focusTimer = setTimeout(() => {
      const first = dialogRef.current?.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      (first || dialogRef.current)?.focus?.();
    }, 0);

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        // Simple focus trap — cycle within dialog.
        const focusables = dialogRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(focusTimer);
      // Return focus to whatever was focused before the modal opened so
      // keyboard users land back where they were.
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch {}
      }
    };
  }, [open, onClose]);

  if (!open) return null;
  const titleId = title ? 'modal-title' : undefined;
  const descId = description ? 'modal-desc' : undefined;
  const widthCls = SIZE_MAP[size] || SIZE_MAP.md;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-fade-in"
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={`relative w-full ${widthCls} glass rounded-xl p-6 animate-fade-in outline-none`}
      >
        {title && (
          <h3
            id={titleId}
            className="font-display font-bold uppercase tracking-[0.14em] text-text-primary text-[17px] mb-2"
          >
            {title}
          </h3>
        )}
        {description && (
          <p id={descId} className="text-text-secondary text-[13px] mb-3">
            {description}
          </p>
        )}
        <div className="text-text-secondary text-[13px]">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2 flex-wrap">{footer}</div>}
      </div>
    </div>
  );
}
