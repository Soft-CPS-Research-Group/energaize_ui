/* Visual thesis: a calm planning table with one shared time axis, matching the community workspace.
   Content: equipment/scenario, source windows, forecast provenance, discussion and audit.
   Interaction: explicit scenario switches, local request edits and a reversible reset. */
import { useState } from 'react';
import { ArrowLeft, FlaskConical, RotateCcw } from 'lucide-react';
import { demoAction, demoEquipment, demoScenarios, durationHours, formatDemoTime, makeDemo, windowState, type Source } from './flexibilityDemoModel';
import './flexibility-demo.css';

const sources: Record<Source, string> = { recurring: 'Recorrente', punctual: 'Pontual', forecast: 'Forecast' };
const states = { available: 'No período de validade', cancelled: 'Cancelado', expired: 'Expirado' };
const forecastStates = { ready: 'Resultado recebido', waiting: 'À espera do resultado', no_history: 'Sem histórico suficiente', error: 'Erro no predictor' };

/** Entirely in memory. No API client, persistence, predictor or equipment commands. */
export function FlexibilityForecastDemo({ onClose }: { onClose?: () => void }) {
  const [state, setState] = useState(() => makeDemo());
  const equipment = demoEquipment.find(item => item.id === state.assetId)!;
  const forecast = state.windows.find(w => w.source === 'forecast');
  const punctual = state.windows.find(w => w.source === 'punctual' && !w.cancelled);
  const scenario = demoScenarios.find(item => item.id === state.scenario)!;
  const origin = Date.parse(state.windows[0].startsAt);
  const until = Math.max(...state.windows.map(w => Date.parse(w.endsAt)));
  const span = until - origin;
  const act = (action: Parameters<typeof demoAction>[1]) => setState(current => demoAction(current, action));

  return <main className="flex-demo" lang="pt-PT">
    <header className="flex-demo-head">
      <div><span className="flex-demo-kicker"><FlaskConical size={16} /> Demonstração · dados simulados</span>
        <h1>Flexibilidade e previsões</h1><p>Compare as fontes e experimente alterações antes de definir a seleção automática.</p></div>
      <div className="flex-demo-actions">{onClose && <button onClick={onClose}><ArrowLeft size={16}/> Voltar ao calendário</button>}
        <button onClick={() => setState(makeDemo(state.assetId, state.scenario))}><RotateCcw size={16}/> Repor cenário</button></div>
    </header>
    <p className="flex-demo-notice" role="note">Todos os equipamentos, pedidos e resultados desta página são fictícios. As alterações duram apenas nesta demonstração e não acionam equipamentos.</p>
    <section className="flex-demo-controls" aria-label="Configuração da demonstração">
      <label>Equipamento<select value={state.assetId} onChange={event => setState(makeDemo(event.target.value, state.scenario))}>
        {demoEquipment.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <label>Cenário<select value={state.scenario} onChange={event => setState(makeDemo(state.assetId, event.target.value))}>
        {demoScenarios.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>
      <p><strong>{equipment.requirement}</strong><span>Horas de Lisboa · relógio simulado: {formatDemoTime(state.now)}</span></p>
    </section>
    <div className="flex-demo-workspace">
      <section className="flex-demo-windows" aria-labelledby="flex-demo-windows-title">
        <div className="flex-demo-section-head"><h2 id="flex-demo-windows-title">Janelas por origem</h2><span>Escolha automática por definir</span></div>
        <div className="flex-demo-axis" aria-hidden="true"><span>{formatDemoTime(state.windows[0].startsAt)}</span><span>{formatDemoTime(new Date(until).toISOString())}</span></div>
        <ul className="flex-demo-window-list">{state.windows.map(window => {
          const status = windowState(window, state.now);
          return <li key={window.id} className={`flex-demo-window flex-demo-${window.source} flex-demo-${status}`} aria-label={`${sources[window.source]} · revisão ${window.revision} · ${states[status]}`}>
            <div className="flex-demo-window-head"><strong>{sources[window.source]}</strong><span>{states[status]} · revisão {window.revision}</span></div>
            <p>{window.meaning === 'usual_use' ? 'Utilização habitual estimada — não define disponibilidade' : window.source === 'forecast' ? 'Disponibilidade estimada — hipótese deste cenário' : 'Disponibilidade declarada pelo utilizador fictício'}</p>
            <div className="flex-demo-track" aria-hidden="true"><span style={{ left: `${100 * (Date.parse(window.startsAt) - origin) / span}%`, width: `${100 * (Date.parse(window.endsAt) - Date.parse(window.startsAt)) / span}%` }}/></div>
            <p className="flex-demo-times"><time dateTime={window.startsAt}>{formatDemoTime(window.startsAt)}</time><span>→</span><time dateTime={window.endsAt}>{formatDemoTime(window.endsAt)}</time><strong>{durationHours(window)} h reais</strong></p>
            {window.source === 'punctual' && !window.cancelled && <div className="flex-demo-actions"><button onClick={() => act('earlier')}>Antecipar fim em 1 hora</button><button onClick={() => act('cancel')}>Cancelar pedido pontual</button></div>}
          </li>;
        })}</ul>
        {!punctual && <button className="flex-demo-primary" onClick={() => act('create')}>Criar novo pedido pontual simulado</button>}
        <p className="flex-demo-footnote">A recorrência é apresentada como uma ocorrência de exemplo. A expansão real das séries pertence ao backend. Cancelar o pedido pontual preserva a previsão e o histórico.</p>
      </section>
      <aside className="flex-demo-inspector" aria-label="Estado e origem da previsão">
        <h2>Previsão simulada</h2><p className={`flex-demo-status flex-demo-status-${state.forecastStatus}`} role="status">{forecastStates[state.forecastStatus]}</p>
        <dl><div><dt>Pedido</dt><dd>{state.requestId}</dd></div><div><dt>Equipamento</dt><dd>{equipment.name}</dd></div>
          {forecast && <><div><dt>Origem</dt><dd>Forecast · {forecast.model}</dd></div><div><dt>Gerada em</dt><dd>{formatDemoTime(forecast.generatedAt!)}</dd></div><div><dt>Válida até</dt><dd>{formatDemoTime(forecast.validUntil!)}</dd></div></>}
        </dl>
        {state.forecastStatus === 'waiting' && <button className="flex-demo-primary" onClick={() => act('receive')}>Receber resultado simulado</button>}
        {state.forecastStatus === 'ready' && <div className="flex-demo-actions"><button onClick={() => act('duplicate')}>Simular reentrega</button><button onClick={() => act('late')}>Simular resultado antigo</button></div>}
        {state.forecastStatus === 'no_history' && <p>Sem dados suficientes para estimar. Não significa disponibilidade zero.</p>}
        {state.forecastStatus === 'error' && <p>O cálculo falhou. Os pedidos declarados continuam visíveis.</p>}
        {forecast && windowState(forecast, state.now) === 'expired' && <p role="status">Esta previsão perdeu validade. Permanece visível como histórico.</p>}
        <p className="flex-demo-footnote">O significado da saída, os campos e o contrato reais serão acordados com Bernardo. Não há aprovação individual de forecasts.</p>
      </aside>
    </div>
    <section className="flex-demo-discussion" aria-labelledby="flex-demo-discussion-title">
      <span className="flex-demo-kicker">Para discussão</span><h2 id="flex-demo-discussion-title">Que fonte deve o backend utilizar?</h2><p>{scenario.question}</p>
      <div><strong>Nenhuma fonte selecionada nesta demonstração.</strong><p>A escolha da fonte e a otimização do horário são decisões distintas. O método de registo existe; a política ainda será acordada.</p></div>
    </section>
    <details className="flex-demo-history" open><summary>Histórico desta demonstração ({state.history.length})</summary>
      <ol aria-live="polite">{state.history.map((entry, index) => <li key={index}>{entry}</li>)}</ol>
    </details>
  </main>;
}
