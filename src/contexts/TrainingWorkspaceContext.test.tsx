import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TrainingWorkspaceProvider, TrainingWorkspaceGate, TrainingWorkspaceSelector, useTrainingWorkspace } from './TrainingWorkspaceContext';
vi.mock('./AuthContext', () => ({ useAuth: () => ({ session: { email: 'operator@test', role: 'training_manager', training_token: 'token' } }) }));
vi.mock('../api/trainingContext', () => ({ TRAINING_ENABLED: true, TRAINING_WORKSPACE_KEY: 'test-workspace', trainingWorkspaceId: () => 'laboratory', trainingRequest: async () => ({ items: [{ id: 'laboratory', name: 'Laboratory', kind: 'laboratory', actions: ['read', 'manage'] }, { id: 'community:one', name: 'Community One', kind: 'community', actions: ['read', 'manage'] }], warnings: [] }) }));
function setup(child: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><TrainingWorkspaceProvider><TrainingWorkspaceSelector /><TrainingWorkspaceGate>{child}</TrainingWorkspaceGate></TrainingWorkspaceProvider></MemoryRouter></QueryClientProvider>);
}
describe('Connected workspace boundary', () => {
  it('separates identical query keys when switching workspace', async () => {
    function Page() { const { id } = useTrainingWorkspace(); const q = useQuery({queryKey: ['shared-key'], queryFn: async () => id}); return <p data-testid="result">{q.data}</p>; }
    setup(<Page />); await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('laboratory'));
    await userEvent.click(screen.getByRole('button', { name: /AI Manager/ }));
    await userEvent.click(screen.getByRole('button', { name: /Community One/ }));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('community:one'));
    expect(screen.getByTestId('result')).not.toHaveTextContent('laboratory');
  });
  it('disables switching while a workspace write is pending', async () => {
    let finish: (() => void) | undefined;
    function Page() { const m = useMutation({ mutationFn: () => new Promise<void>(resolve => { finish = resolve; }) }); return <button onClick={() => m.mutate()}>Save change</button>; }
    setup(<Page />); await userEvent.click(await screen.findByRole('button', {name: 'Save change'}));
    await userEvent.click(screen.getByRole('button', {name: /AI Manager/}));
    expect(screen.getByRole('button', {name: /Community One/})).toBeDisabled();
    await act(async () => { finish?.(); });
    await waitFor(() => expect(screen.getByRole('button', {name: /Community One/})).toBeEnabled());
  });
});
