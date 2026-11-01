import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlexibilityForecastDemo } from './FlexibilityForecastDemo';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Flexibility forecast demo workflow', () => {
  it('shows concrete policy outcomes and explains the missing forecast when changing scenario', async () => {
    const user = userEvent.setup(); render(<FlexibilityForecastDemo />);
    const policyB = () => within(screen.getByRole('article', { name: 'B · Cruzar declaração e previsão' }));
    expect(policyB().getByText(/Usa apenas a parte comum/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Cenário'),'waiting');
    expect(screen.getByText(/Não há janela prevista para desenhar/)).toBeVisible();
    expect(policyB().getByText(/Sem forecast utilizável/)).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Receber resultado simulado'}));
    expect(policyB().getByText(/Usa apenas a parte comum/)).toBeVisible();
    expect(screen.queryByText(/Não há janela prevista para desenhar/)).not.toBeInTheDocument();
  });
  it('identifies simulation, edits and cancels a request without touching APIs or forecast history', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<FlexibilityForecastDemo />);
    expect(screen.getByRole('note')).toHaveTextContent('fictícios');
    expect(screen.getByText('Nenhuma política aprovada para produção.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Antecipar fim em 1 hora' }));
    expect(screen.getByRole('listitem', { name: /Pontual · revisão 2/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido pontual' }));
    expect(screen.getByRole('listitem', { name: /Pontual · revisão 3 · Cancelado/ })).toBeVisible();
    expect(screen.getByRole('listitem', { name: /Forecast · revisão 1/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Criar novo pedido pontual simulado' }));
    expect(screen.getAllByRole('listitem', { name: /Pontual/ })).toHaveLength(2);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('simulates asynchronous receipt, duplicate delivery and an old result, and resets locally', async () => {
    const user = userEvent.setup(); render(<FlexibilityForecastDemo />);
    await user.selectOptions(screen.getByLabelText('Cenário'), 'waiting');
    expect(within(screen.getByRole('complementary', { name: 'Estado e origem da previsão' })).getByRole('status')).toHaveTextContent('À espera');
    expect(screen.queryByRole('listitem', { name: /Forecast/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Receber resultado simulado' }));
    expect(within(screen.getByRole('complementary', { name: 'Estado e origem da previsão' })).getByRole('status')).toHaveTextContent('Resultado recebido');
    await user.click(screen.getByRole('button', { name: 'Simular reentrega' }));
    await user.click(screen.getByRole('button', { name: 'Simular resultado antigo' }));
    expect(screen.getAllByRole('listitem', { name: /Forecast/ })).toHaveLength(1);
    expect(screen.getByText(/mesmo pedido e revisão/)).toBeVisible();
    expect(screen.getByText(/revisão anterior à já recebida/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Repor cenário' }));
    expect(within(screen.getByRole('complementary', { name: 'Estado e origem da previsão' })).getByRole('status')).toHaveTextContent('À espera');
    expect(screen.queryByText(/mesmo pedido e revisão/)).not.toBeInTheDocument();
  });
  it('explains absent/failed/expired forecasts and does not ask for human approval', async () => {
    const user = userEvent.setup(); render(<FlexibilityForecastDemo />);
    for (const [scenario, message] of [['no-history', 'Não significa disponibilidade zero.'], ['error', 'Os pedidos declarados continuam visíveis.'], ['expired', 'Esta previsão perdeu validade.']]) {
      await user.selectOptions(screen.getByLabelText('Cenário'), scenario);
      expect(screen.getByText(text => text.includes(message))).toBeVisible();
      expect(screen.queryByRole('button', { name: /aprovar|confirmar/i })).not.toBeInTheDocument();
    }
  });
  it('isolates equipment and shows the washer cycle, then a DST night', async () => {
    const user = userEvent.setup(); render(<FlexibilityForecastDemo />);
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido pontual' }));
    await user.selectOptions(screen.getByLabelText('Equipamento'), 'demo-washer');
    expect(screen.getByText('Ciclo Eco · 90 minutos, definidos no equipamento')).toBeVisible();
    expect(screen.queryByRole('listitem', { name: /Cancelado/ })).not.toBeInTheDocument();
    expect(screen.queryByText('demo-ev-overlap-request')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Antecipar fim em 1 hora' }));
    expect(screen.getByText(/Alteração recusada/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Equipamento'), 'demo-ev');
    await user.selectOptions(screen.getByLabelText('Cenário'), 'spring');
    const row = screen.getByRole('listitem', { name: /Recorrente/ });
    expect(within(row).getByText('13 h reais')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Cenário'), 'autumn');
    expect(within(screen.getByRole('listitem', { name: /Recorrente/ })).getByText('15 h reais')).toBeVisible();
  });
});
