export const RELEASES_URL = 'https://github.com/HappyMonkeyAI/ZeroG-SFTP/releases';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/HappyMonkeyAI/ZeroG-SFTP/releases/latest';

export type UpdateMode = 'notify' | 'disabled';
export interface LatestRelease { version: string; releaseUrl: string }
export type UpdateState =
  | { status: 'idle'; mode: UpdateMode; currentVersion: string }
  | { status: 'checking'; mode: UpdateMode; currentVersion: string }
  | { status: 'current'; mode: UpdateMode; currentVersion: string; checkedAt: number }
  | { status: 'available'; mode: UpdateMode; currentVersion: string; version: string; releaseUrl: string }
  | { status: 'error'; mode: UpdateMode; currentVersion: string; message: string };

export function updateMode(isPackaged: boolean): UpdateMode {
  return isPackaged ? 'notify' : 'disabled';
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^v/i, '');
  return VERSION_RE.test(trimmed) ? trimmed : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  const leftCore = pa.split('-')[0].split('.').map(Number);
  const rightCore = pb.split('-')[0].split('.').map(Number);
  const leftPre = pa.includes('-') ? pa.slice(pa.indexOf('-') + 1).split('.') : [];
  const rightPre = pb.includes('-') ? pb.slice(pb.indexOf('-') + 1).split('.') : [];
  for (let index = 0; index < 3; index += 1) if (leftCore[index] !== rightCore[index]) return leftCore[index] < rightCore[index] ? -1 : 1;
  if (!leftPre.length || !rightPre.length) return Math.sign(rightPre.length - leftPre.length);
  for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index += 1) {
    const left = leftPre[index];
    const right = rightPre[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff) return Math.sign(diff);
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return parseVersion(candidate) !== null && parseVersion(current) !== null && compareVersions(candidate, current) > 0;
}

export function safeReleaseUrl(value: unknown): string {
  if (typeof value !== 'string') return RELEASES_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) return RELEASES_URL;
    const allowed = `${RELEASES_URL}/`;
    if (value !== RELEASES_URL && !value.startsWith(allowed)) return RELEASES_URL;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return RELEASES_URL;
  }
}

export function releaseUrlFor(version: string): string {
  const parsed = parseVersion(version);
  return parsed ? `${RELEASES_URL}/tag/v${parsed}` : RELEASES_URL;
}

export function parseLatestRelease(body: unknown): LatestRelease | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;
  if (data.draft === true || data.prerelease === true) return null;
  const version = parseVersion(data.tag_name ?? data.name);
  if (!version) return null;
  return { version, releaseUrl: safeReleaseUrl(data.html_url) };
}

export function shouldPrompt(state: UpdateState | null, skippedVersion: string, dismissedVersion: string | null, manual = false): boolean {
  if (!state || (state.status !== 'available' && state.status !== 'error')) return false;
  if (manual) return true;
  if (state.status === 'error') return false;
  return state.version !== skippedVersion && state.version !== dismissedVersion;
}
