import { describe, it, expect, beforeEach } from 'vitest';
import { readSnapshot, writeSnapshot, clearSnapshots, SNAPSHOT_VERSION } from '@/lib/snapshot';

const JOE = '13efdfc1-d276-4a93-b4ff-9f238d5f4793';
const KATIE = '72e11e46-d6cb-42c2-b8eb-7e4dc82ec8eb';

describe('per-user snapshots', () => {
  beforeEach(() => localStorage.clear());

  it("Joe never reads Katie's snapshot", () => {
    writeSnapshot(KATIE, 'home-list-todo', [{ id: 'k1' }]);
    expect(readSnapshot(JOE, 'home-list-todo')).toBeNull();
    expect(readSnapshot(KATIE, 'home-list-todo')).toEqual([{ id: 'k1' }]);
  });

  it('sign out clears every snapshot but leaves other storage', () => {
    writeSnapshot(JOE, 'weather', { temp: 1 });
    writeSnapshot(KATIE, 'weather', { temp: 2 });
    localStorage.setItem('other', 'keep');
    clearSnapshots();
    expect(readSnapshot(JOE, 'weather')).toBeNull();
    expect(readSnapshot(KATIE, 'weather')).toBeNull();
    expect(localStorage.getItem('other')).toBe('keep');
  });

  it('corrupted or older-format snapshots fall back to a normal load', () => {
    localStorage.setItem(`perritt-snap:${JOE}:a`, '{not json');
    localStorage.setItem(`perritt-snap:${JOE}:b`, JSON.stringify({ v: SNAPSHOT_VERSION - 1, u: JOE, d: [1] }));
    localStorage.setItem(`perritt-snap:${JOE}:c`, JSON.stringify({ v: SNAPSHOT_VERSION, u: KATIE, d: [1] }));
    expect(readSnapshot(JOE, 'a')).toBeNull();
    expect(readSnapshot(JOE, 'b')).toBeNull();
    expect(readSnapshot(JOE, 'c')).toBeNull();
  });

  it('no user means no snapshot', () => {
    writeSnapshot(null, 'x', 1);
    expect(readSnapshot(undefined, 'x')).toBeNull();
  });
});
