import { describe, it, expect } from 'vitest';
import { parsePushLink } from '@/lib/reminderLink';

describe('reminder push link', () => {
  it('only accepts links marked from=push', () => {
    expect(parsePushLink('?todo=abc&reminderUser=u1&from=push')).toEqual({ todoId: 'abc', userId: 'u1' });
    expect(parsePushLink('?todo=abc&reminderUser=u1')).toBeNull();
    expect(parsePushLink('?from=push')).toBeNull();
  });
});
