/** Presentation fixtures only. No predictor protocol, precedence or production writes. */
export type Source = 'recurring' | 'punctual' | 'forecast';
export type ForecastStatus = 'waiting' | 'ready' | 'no_history' | 'error';
export interface DemoWindow {
  id: string;
  assetId: string;
  source: Source;
  revision: number;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  meaning: 'availability' | 'usual_use';
  generatedAt?: string;
  validUntil?: string;
  model?: string;
}
export interface DemoState {
  assetId: string;
  scenario: string;
  now: string;
  windows: DemoWindow[];
  forecastStatus: ForecastStatus;
  requestId: string;
  resultRevision: number;
  history: string[];
}
export const demoEquipment = [
  { id: 'demo-ev', name: 'Casa A · EV / carregador', requirement: 'EV demonstrativo · objetivo à partida: 80% SoC', type: 'ev' },
  { id: 'demo-washer', name: 'Casa A · Máquina de lavar', requirement: 'Ciclo Eco · 90 minutos, definidos no equipamento', type: 'washer' },
];
export const demoScenarios = [
  { id: 'overlap', name: 'Fontes sobrepostas', question: 'A exceção pontual substitui a ocorrência recorrente? Como usar o forecast quando prevê uma chegada mais tarde?' },
  { id: 'usual-use', name: 'Utilização habitual ≠ disponibilidade', question: 'Uma utilização prevista às 20h não demonstra disponibilidade entre as 18h e as 08h. Que significado deve ter esta saída?' },
  { id: 'waiting', name: 'À espera do resultado', question: 'Enquanto não há resultado, que fontes continuam utilizáveis? Qual deve ser o prazo da previsão?' },
  { id: 'no-history', name: 'Sem histórico', question: 'Sem histórico é ausência de informação, e não disponibilidade zero. Que comportamento de recurso queremos?' },
  { id: 'error', name: 'Falha do predictor', question: 'Uma falha técnica deve ser distinguida de uma previsão de indisponibilidade. Quando devemos tentar novamente?' },
  { id: 'expired', name: 'Previsão expirada', question: 'Como tratar uma previsão histórica que perdeu validade enquanto os pedidos explícitos continuam válidos?' },
  { id: 'spring', name: 'Mudança de hora · primavera', question: 'A janela conserva as horas locais; tem menos uma hora real. O requisito do equipamento continua a caber?' },
  { id: 'autumn', name: 'Mudança de hora · outono', question: 'A janela tem mais uma hora real. Como representar horas repetidas sem ambiguidade?' },
];
export function makeDemo(assetId = 'demo-ev', scenario = 'overlap'): DemoState {
  const washer = assetId === 'demo-washer';
  const start = scenario === 'spring' ? '2026-03-28T18:00:00Z' : scenario === 'autumn' ? '2026-10-24T17:00:00Z' : '2026-11-02T18:00:00Z';
  const end = scenario === 'spring' ? '2026-03-29T07:00:00Z' : scenario === 'autumn' ? '2026-10-25T08:00:00Z' : '2026-11-03T08:00:00Z';
  const base = Date.parse(start);
  const now = new Date(base - 6 * 3600000).toISOString();
  const windows: DemoWindow[] = [{ id: 'recurring', assetId, source: 'recurring', revision: 1, startsAt: start,
    endsAt: washer ? new Date(base + 4 * 3600000).toISOString() : end, cancelled: false, meaning: 'availability' }];
  windows.push({ ...windows[0], id: 'punctual', source: 'punctual', startsAt: new Date(base + 3600000).toISOString(),
    endsAt: new Date(Date.parse(windows[0].endsAt) - 3600000).toISOString() });
  const forecastStatus: ForecastStatus = scenario === 'waiting' ? 'waiting' : scenario === 'no-history' ? 'no_history' : scenario === 'error' ? 'error' : 'ready';
  if (forecastStatus === 'ready') windows.push({ ...windows[0], id: 'forecast', source: 'forecast',
    startsAt: new Date(base + 2 * 3600000).toISOString(),
    endsAt: scenario === 'usual-use' ? new Date(base + (washer ? 3.5 : 3) * 3600000).toISOString() : windows[0].endsAt,
    meaning: scenario === 'usual-use' ? 'usual_use' : 'availability', generatedAt: now,
    validUntil: new Date(Date.parse(now) + (scenario === 'expired' ? -1 : 24) * 3600000).toISOString(), model: 'Modelo demonstrativo · v1' });
  return { assetId, scenario, now, windows, forecastStatus, requestId: `${assetId}-${scenario}-request`, resultRevision: forecastStatus === 'ready' ? 1 : 0,
    history: ['Pedido de previsão simulado criado e enviado.', forecastStatus === 'ready' ? 'Resultado simulado recebido e associado ao equipamento.' : forecastStatus === 'waiting' ? 'Receção do pedido confirmada; resultado ainda pendente.' : forecastStatus === 'no_history' ? 'Resultado recebido: histórico insuficiente.' : 'Falha simulada no cálculo da previsão.'] };
}
export function windowState(window: DemoWindow, now: string): 'cancelled' | 'expired' | 'available' {
  if (window.cancelled) return 'cancelled';
  if (Date.parse(window.endsAt) <= Date.parse(now) || (window.validUntil && Date.parse(window.validUntil) <= Date.parse(now))) return 'expired';
  return 'available';
}
export function demoAction(state: DemoState, action: 'earlier' | 'cancel' | 'create' | 'receive' | 'duplicate' | 'late'): DemoState {
  const row = state.windows.find(w => w.source === 'punctual' && !w.cancelled);
  const record = (text: string, patch: Partial<DemoState> = {}) => ({ ...state, ...patch, history: [...state.history, text] });
  if (action === 'receive') {
    if (state.forecastStatus !== 'waiting') return state;
    const fixture = makeDemo(state.assetId, 'overlap').windows.find(w => w.source === 'forecast')!;
    return record('Resultado simulado recebido · revisão 1. Nenhuma fonte foi selecionada.', {
      forecastStatus: 'ready', resultRevision: 1, windows: [...state.windows, { ...fixture, generatedAt: state.now, validUntil: new Date(Date.parse(state.now) + 86400000).toISOString() }],
    });
  }
  if (action === 'duplicate' || action === 'late') {
    if (state.forecastStatus !== 'ready') return state;
    return record(action === 'duplicate' ? 'Reentrega simulada ignorada: mesmo pedido e revisão; nenhuma duplicação.' : 'Resultado antigo simulado ignorado: revisão anterior à já recebida.');
  }
  if (action === 'cancel' && row) return record(`Pedido pontual cancelado · revisão ${row.revision + 1}. Forecast preservado.`, {
    windows: state.windows.map(w => w.id === row.id ? { ...w, revision: w.revision + 1, cancelled: true } : w),
  });
  if (action === 'earlier' && row) {
    const endsAt = new Date(Date.parse(row.endsAt) - 3600000).toISOString();
    if (Date.parse(endsAt) - Date.parse(row.startsAt) < (state.assetId === 'demo-washer' ? 90 : 1) * 60000) return record('Alteração recusada: a janela já não comporta o requisito do equipamento.');
    return record(`Fim do pedido pontual antecipado em 1 hora · revisão ${row.revision + 1}.`, {
      windows: state.windows.map(w => w.id === row.id ? { ...w, revision: w.revision + 1, endsAt } : w),
    });
  }
  if (action === 'create' && !row) {
    const previous = state.windows.find(w => w.source === 'punctual');
    if (!previous) return state;
    return record(`Novo pedido pontual criado · revisão 1. Cancelamento anterior preservado no histórico.`, {
      windows: [...state.windows, { ...previous, id: `punctual-${state.history.length}`, revision: 1, cancelled: false }],
    });
  }
  return state;
}
export function formatDemoTime(value: string): string {
  return new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
}
export function durationHours(window: DemoWindow): number { return (Date.parse(window.endsAt) - Date.parse(window.startsAt)) / 3600000; }
