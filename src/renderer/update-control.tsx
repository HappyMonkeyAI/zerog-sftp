import React, { useEffect, useRef, useState } from 'react';
import type { UpdateState } from '../shared/update.js';
import { updateSummary } from './update-view.js';

export function UpdateControl(props: {
  state: UpdateState | null;
  checkOnStartup: boolean;
  skippedVersion: string;
  onStartupChange: (checkOnStartup: boolean) => void;
  onCheck: () => void;
  onClearSkipped: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const disabled = props.state?.mode === 'disabled';

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="update-control" ref={rootRef}>
      <button
        type="button"
        className="update-control-button"
        title={updateSummary(props.state)}
        aria-label="Updates"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        Updates
      </button>
      {open && (
        <div className="update-menu" role="dialog" aria-label="Update settings">
          <p className="update-menu-status">{updateSummary(props.state)}</p>
          <label className="update-menu-toggle">
            <input
              type="checkbox"
              checked={props.checkOnStartup}
              onChange={(event) => props.onStartupChange(event.target.checked)}
            />
            <span>Check for updates on startup</span>
          </label>
          <div className="update-menu-actions">
            <button type="button" disabled={props.state?.status === 'checking'} onClick={() => { setOpen(false); props.onCheck(); }}>Check now</button>
            <button type="button" disabled={!props.skippedVersion} onClick={props.onClearSkipped}>{props.skippedVersion ? `Clear skipped ${props.skippedVersion}` : 'No skipped version'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
