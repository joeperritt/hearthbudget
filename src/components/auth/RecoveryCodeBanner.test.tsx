import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryCodeBanner } from './RecoveryCodeBanner';

const FLAG_KEY = 'keeper.lastAuthMethod';
const DISMISS_KEY = 'keeper.recoveryBannerDismissed';

const setFlag = (remaining: number) => {
  localStorage.setItem(
    FLAG_KEY,
    JSON.stringify({ method: 'recovery_code', remaining, at: Date.now() }),
  );
};

describe('RecoveryCodeBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('renders nothing when no recovery flag is set', () => {
    const { container } = render(<RecoveryCodeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders neutral banner with remaining count when 4+ codes left', () => {
    setFlag(7);
    render(<RecoveryCodeBanner />);
    expect(screen.getByText(/signed in with a recovery code/i)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('renders LOW-warning banner when 3 or fewer codes left', () => {
    setFlag(2);
    render(<RecoveryCodeBanner />);
    expect(screen.getByText(/Only 2 recovery codes left/i)).toBeInTheDocument();
    expect(screen.getByText(/Regenerate now/i)).toBeInTheDocument();
  });

  it('renders LOW-warning at exactly 3 codes (boundary)', () => {
    setFlag(3);
    render(<RecoveryCodeBanner />);
    expect(screen.getByText(/Only 3 recovery codes left/i)).toBeInTheDocument();
  });

  it('does NOT render LOW warning at 4 codes (just above boundary)', () => {
    setFlag(4);
    render(<RecoveryCodeBanner />);
    expect(screen.queryByText(/Only 4 recovery codes left/i)).not.toBeInTheDocument();
    expect(screen.getByText(/signed in with a recovery code/i)).toBeInTheDocument();
  });

  it('hides itself after dismiss button is clicked', () => {
    setFlag(5);
    render(<RecoveryCodeBanner />);
    expect(screen.getByText(/signed in with a recovery code/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText(/signed in with a recovery code/i)).not.toBeInTheDocument();
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe('1');
  });

  it('stays hidden when DISMISS_KEY is already set', () => {
    setFlag(5);
    sessionStorage.setItem(DISMISS_KEY, '1');
    const { container } = render(<RecoveryCodeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores flags from non-recovery auth methods', () => {
    localStorage.setItem(
      FLAG_KEY,
      JSON.stringify({ method: 'totp', remaining: 0, at: Date.now() }),
    );
    const { container } = render(<RecoveryCodeBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onOpenSecurity when CTA is clicked', () => {
    setFlag(2);
    const handler = vi.fn();
    render(<RecoveryCodeBanner onOpenSecurity={handler} />);
    fireEvent.click(screen.getByText(/Regenerate now/i));
    expect(handler).toHaveBeenCalledOnce();
  });
});
