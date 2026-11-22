import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkForNewBuild } from '@/lib/appUpdate';

const page = (src: string) => `<html><head><script type="module" crossorigin src="${src}"></script></head></html>`;

describe('picking up a new publish', () => {
  beforeEach(() => { sessionStorage.clear(); document.head.innerHTML = '<script type="module" src="/assets/index-OLD.js"></script>'; });

  it('reloads once when a newer publish exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(page('/assets/index-NEW.js'), { status: 200 })));
    const reload = vi.fn();
    expect(await checkForNewBuild(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await checkForNewBuild(reload)).toBe(false); // no reload loop
  });

  it('does nothing when already on the latest publish', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(page('/assets/index-OLD.js'), { status: 200 })));
    const reload = vi.fn();
    expect(await checkForNewBuild(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
