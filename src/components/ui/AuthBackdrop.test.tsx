import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthBackdrop } from './AuthBackdrop';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('shared login backgrounds', () => {
  it('can pause rotation and releases its timer when leaving login', () => {
    vi.useFakeTimers();
    const view = render(<AuthBackdrop />);
    const visible = () => view.container.querySelector('.is-visible');
    const first = visible();
    act(() => { vi.advanceTimersByTime(9000); });
    expect(visible()).not.toBe(first);
    fireEvent.click(screen.getByRole('button', {name: 'Pause backgrounds'}));
    const paused = visible();
    act(() => { vi.advanceTimersByTime(18000); });
    expect(visible()).toBe(paused);
    fireEvent.click(screen.getByRole('button', {name: 'Resume backgrounds'}));
    act(() => { vi.advanceTimersByTime(9000); });
    expect(visible()).not.toBe(paused);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the scene still for reduced motion', () => {
    vi.useFakeTimers();
    const remove = vi.fn();
    vi.stubGlobal('matchMedia', () => ({matches:true,addEventListener:vi.fn(),removeEventListener:remove}));
    const view = render(<AuthBackdrop />);
    const first = view.container.querySelector('.is-visible');
    act(() => { vi.advanceTimersByTime(27000); });
    expect(view.container.querySelector('.is-visible')).toBe(first);
    expect(screen.queryByRole('button')).toBeNull();
    view.unmount();
    expect(remove).toHaveBeenCalled();
  });
});
