import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parsePsOutput, runningDshProcesses } from '../lib/processes.js';

describe('parsePsOutput', () => {
  test('finds a node-launched dsh web process', () => {
    const r = parsePsOutput(
      '26911 node /Users/x/.nvm/versions/node/v24.15.0/bin/dsh web\n' +
        '  123 /usr/sbin/syslogd\n',
    );
    assert.deepEqual(r, [
      { pid: 26911, command: 'node /Users/x/.nvm/versions/node/v24.15.0/bin/dsh web' },
    ]);
  });

  test('finds a bare dsh invocation and a --profile variant', () => {
    const r = parsePsOutput('1 dsh web\n2 /opt/bin/dsh --profile acp serve\n');
    assert.deepEqual(r.map((p) => p.pid), [1, 2]);
  });

  test('does not match dsh-prefixed binaries or path segments', () => {
    const r = parsePsOutput(
      '10 node /bin/dsh-recovery fix\n' +
        '11 node /Users/x/workspace/dsh-refine/smoke-host.mjs\n' +
        '12 /opt/dsh-doctor/bin/run\n',
    );
    assert.deepEqual(r, []);
  });

  test('does not match the ps invocation that produced the output', () => {
    const r = parsePsOutput('99 ps ax -o pid=,command=\n');
    assert.deepEqual(r, []);
  });

  test('does not match a shell that merely mentions dsh in its arguments', () => {
    // `dsh doctor` is normally typed at a shell prompt, so the shell's own
    // command line contains "dsh". Reporting it would tell the user to restart
    // their terminal to make a module relink take effect.
    const r = parsePsOutput(
      '20 /bin/zsh -c source ~/.zshrc && dsh doctor\n' +
        '21 /bin/sh -c dsh web\n' +
        '22 npm exec dsh --profile web\n',
    );
    assert.deepEqual(r, []);
  });

  test('matches a node-launched dsh even behind interpreter flags', () => {
    const r = parsePsOutput('30 node --enable-source-maps /usr/local/bin/dsh --profile web\n');
    assert.deepEqual(r.map((p) => p.pid), [30]);
  });

  test('ignores malformed lines and non-numeric pids', () => {
    const r = parsePsOutput('garbage\nPID COMMAND\n  abc node /bin/dsh web\n');
    assert.deepEqual(r, []);
  });

  test('empty input yields an empty list', () => {
    assert.deepEqual(parsePsOutput(''), []);
  });

  test('excludes the pids it is told to — this run and its launcher', () => {
    // `dsh doctor` reaches the CLI through the `dsh` launcher, so both match the
    // pattern. Naming them would tell the user to restart the very command that
    // just did the repair.
    const text = '1 dsh web\n2 node /bin/dsh doctor\n3 node /bin/dsh --profile acp\n';
    assert.deepEqual(parsePsOutput(text, [2, 3]).map((p) => p.pid), [1]);
    assert.deepEqual(parsePsOutput(text, []).map((p) => p.pid), [1, 2, 3]);
  });
});

describe('runningDshProcesses', () => {
  test('never throws and returns an array of {pid, command}', () => {
    const r = runningDshProcesses();
    assert.ok(Array.isArray(r));
    for (const p of r) {
      assert.equal(typeof p.pid, 'number');
      assert.equal(typeof p.command, 'string');
    }
  });
});
