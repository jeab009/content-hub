'use client';

import type { JSX } from 'react';

/** Shared modal chrome for the commerce pages — mirrors ActionModalShell (posts page). */
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
