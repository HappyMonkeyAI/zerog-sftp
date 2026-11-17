import { parseLatestRelease, isNewer, type UpdateMode, type UpdateState } from '../shared/update.js';

export interface ReleaseLookup {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

export function shortError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const line = raw.replace(/\s+/g, ' ').trim();
  return (line || 'The update check failed.').slice(0, 197);
}

export class UpdateService {
  private readonly mode: UpdateMode;
  private readonly currentVersion: string;
  private readonly fetchLatest: () => Promise<ReleaseLookup | null>;
  private readonly onChange: (state: UpdateState) => void;
  private state: UpdateState;
  private running: Promise<UpdateState> | null = null;

  constructor(options: { mode: UpdateMode; currentVersion: string; fetchLatest: () => Promise<ReleaseLookup | null>; onChange: (state: UpdateState) => void }) {
    this.mode = options.mode;
    this.currentVersion = options.currentVersion;
    this.fetchLatest = options.fetchLatest;
    this.onChange = options.onChange;
    this.state = { status: 'idle', mode: this.mode, currentVersion: this.currentVersion };
  }

  current(): UpdateState {
    return this.state;
  }

  async check(): Promise<UpdateState> {
    if (this.mode === 'disabled') return this.state;
    this.running ??= this.checkNow().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async checkNow(): Promise<UpdateState> {
    this.publish({ status: 'checking', mode: this.mode, currentVersion: this.currentVersion });
    try {
      const latest = parseLatestRelease(await this.fetchLatest());
      if (!latest || !isNewer(latest.version, this.currentVersion)) {
        this.publish({ status: 'current', mode: this.mode, currentVersion: this.currentVersion, checkedAt: Date.now() });
      } else {
        this.publish({ status: 'available', mode: this.mode, currentVersion: this.currentVersion, version: latest.version, releaseUrl: latest.releaseUrl });
      }
    } catch (error) {
      this.publish({ status: 'error', mode: this.mode, currentVersion: this.currentVersion, message: shortError(error) });
    }
    return this.state;
  }

  private publish(state: UpdateState): void {
    this.state = state;
    this.onChange(state);
  }
}
