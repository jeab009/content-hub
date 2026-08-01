'use client';

/**
 * Shared modal chrome for the paid pages — a deliberate DUPLICATE of
 * `components/commerce/ModalShell.tsx` (ADR-7.6, same reasoning as
 * `PaidExportCsvButton`/ADR-6.8: "some Bootstrap markup is duplicated on
 * purpose"), not a shared import: the paid/commerce/payout ESLint zone
 * (frontend/.eslintrc.js) bans every file under `src/app/paid/**` and
 * `src/components/paid/**` from importing anything under
 * `components/commerce/**`, precisely so no paid surface reaches for a
 * commerce-side component "for convenience" — the same reasoning that gives
 * paid its own DTO vocabulary and its own export button.
 */
export function ModalShell(props: {
  titleId: string;
  heading: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'default' | 'lg';
}): JSX.Element {
  const dialogClass = props.size === 'lg' ? 'modal-dialog modal-lg modal-dialog-scrollable' : 'modal-dialog';
  return (
    <div
      className="modal d-block"
      role="dialog"
      aria-modal="true"
      aria-labelledby={props.titleId}
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className={dialogClass}>
        <div className="modal-content">
          <div className="modal-header">
            <h2 className="modal-title h5" id={props.titleId}>
              {props.heading}
            </h2>
            <button type="button" className="btn-close" aria-label="Close" onClick={props.onClose} />
          </div>
          {props.children}
        </div>
      </div>
    </div>
  );
}
