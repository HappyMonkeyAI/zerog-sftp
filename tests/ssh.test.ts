import { describe, expect, it } from 'vitest';
import { parseSshConfig, profileTarget, validateTarget } from '../src/shared/ssh.js';

describe('SSH profile discovery', () => {
  it('parses aliases and preserves quoted values', () => {
    const profiles = parseSshConfig('Host nas\n  HostName 192.168.5.80\n  User steph\n  Port 2222\n  IdentityFile "C:/Users/steph/.ssh/id_ed25519"\n\nHost *.wild\n  HostName ignored\n');
    expect(profiles).toEqual([{ alias:'nas', hostName:'192.168.5.80', user:'steph', port:2222, identityFile:'C:/Users/steph/.ssh/id_ed25519' }]);
    expect(profileTarget(profiles[0])).toBe('nas');
  });
  it('rejects shell-like targets', () => {
    expect(() => validateTarget('-oProxyCommand=bad')).toThrow();
    expect(() => validateTarget('user@host\nrm -rf')).toThrow();
    expect(validateTarget('steph@nas')).toBe('steph@nas');
  });
});
