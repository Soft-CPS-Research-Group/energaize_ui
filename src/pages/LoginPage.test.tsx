import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AUTH_SCENE_STORAGE_KEY } from '../constants';
import { AuthTransitionProvider, useAuthTransition } from '../contexts/AuthTransitionContext';
import { LoginPage } from './LoginPage';
const mocks = vi.hoisted(() => ({ auth: {session: null as unknown, login: vi.fn()}, navigate: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({useAuth: () => mocks.auth}));
vi.mock('../contexts/UIContext', () => ({useUI: () => ({theme:'light',setTheme:vi.fn()})}));
vi.mock('react-router-dom', () => ({useNavigate: () => mocks.navigate, Navigate: () => <div>Authenticated destination</div>, Link: ({children,to}:{children:React.ReactNode;to:string})=><a href={to}>{children}</a>}));
vi.mock('../components/ui/AuthBackdrop', () => ({AuthBackdrop: () => null}));
vi.mock('../components/layout/InstitutionalDock', () => ({InstitutionalDock: () => null}));
let controls: ReturnType<typeof useAuthTransition>;
function Probe(){controls=useAuthTransition();return null;}
const mount=()=>render(<AuthTransitionProvider><Probe/><LoginPage/></AuthTransitionProvider>);
beforeEach(() => {vi.useFakeTimers(); mocks.auth.session=null; mocks.navigate.mockReset(); sessionStorage.clear();mocks.auth.login.mockImplementation(async () => {const session={role:'prosumer'};mocks.auth.session=session;return session;});});
afterEach(() => {cleanup(); vi.useRealTimers();});
it('navigates immediately to start workspace loading but holds the scene for three seconds', async () => {
 const view=mount();
 await act(async()=> {fireEvent.click(screen.getByRole('button',{name:'Log in'}));});
 expect(mocks.navigate).toHaveBeenCalledTimes(1);
 const scene=view.container.querySelector('.ceramic-charge-scene.is-arrive');
 expect(scene).not.toBeNull();
 expect(view.container.querySelector('.auth-transition-content')?.hasAttribute('inert')).toBe(true);
 act(()=>{vi.advanceTimersByTime(1000);controls.ready();});
 act(()=>vi.advanceTimersByTime(1999));expect(view.container.querySelector('.is-arrive')).toBe(scene);
 act(()=>vi.advanceTimersByTime(1));expect(view.container.querySelector('.is-arrive')).toBeNull();
 expect(mocks.navigate).toHaveBeenCalledTimes(1);
 expect(view.container.querySelector('.auth-transition-content')?.hasAttribute('inert')).toBe(false);
});
it('keeps the same scene past three seconds until a slow workspace is ready',async()=>{
 const view=mount();
 await act(async()=> {fireEvent.click(screen.getByRole('button',{name:'Log in'}));});
 const scene=view.container.querySelector('.is-arrive');
 act(()=>vi.advanceTimersByTime(8000));expect(view.container.querySelector('.is-arrive')).toBe(scene);
 act(()=>controls.ready());expect(view.container.querySelector('.is-arrive')).toBeNull();
 expect(mocks.navigate).toHaveBeenCalledTimes(1);
});
it('keeps the departure scene for three seconds', () => {
 sessionStorage.setItem(AUTH_SCENE_STORAGE_KEY,'logout');const view=mount();
 expect(view.container.querySelector('.is-depart')).not.toBeNull();
 act(()=>vi.advanceTimersByTime(2999));expect(view.container.querySelector('.is-depart')).not.toBeNull();
 act(()=>vi.advanceTimersByTime(1));expect(view.container.querySelector('.is-depart')).toBeNull();
 expect(sessionStorage.getItem(AUTH_SCENE_STORAGE_KEY)).toBeNull();
});
it('returns to the form after an authentication error without navigating',async()=>{
 mocks.auth.login.mockRejectedValueOnce(new Error('Unable to sign in'));const view=mount();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Log in'}));});
 expect(view.container.querySelector('.is-arrive')).toBeNull();expect(screen.getByText('Unable to sign in')).toBeTruthy();
 act(()=>vi.advanceTimersByTime(6000));expect(mocks.navigate).not.toHaveBeenCalled();
});
