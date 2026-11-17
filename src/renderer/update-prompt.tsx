import React, { useEffect, useRef } from 'react';
import type { UpdateState } from '../shared/update.js';
import { updatePromptBody } from './update-view.js';

export function UpdatePrompt(props: {
  state: UpdateState & { status: 'available' };
  onOpenRelease: () => void;
  onLater: () => void;
  onSkip: () => void;
}) {
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    openRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onLater();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  return (
    <div className="update-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onLater();
    }}>
      <section className="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <div className="update-card-head">
          <div>
            <span className="eyebrow">Update</span>
            <h2 id="update-title">ZeroG SFTP {props.state.version}</h2>
          </div>
          <button type="button" className="update-close" aria-label="Close update notice" onClick={props.onLater}>×</button>
        </div>
        <p>{updatePromptBody(props.state)}</p>
        <button type="button" className="update-link" onClick={props.onOpenRelease}>View the release page</button>
        <div className="update-actions">
          <button type="button" className="primary" ref={openRef} onClick={props.onOpenRelease}>Open download page</button>
          <button type="button" onClick={props.onLater}>Later</button>
          <button type="button" onClick={props.onSkip}>Skip this version</button>
        </div>
      </section>
    </div>
  );
}
