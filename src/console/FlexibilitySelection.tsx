import { useEffect, useState, type FormEvent } from 'react';
import { selectionRequest, type ChosenFlexibility, type ChosenOffer, type SelectionPolicy, type SelectionSettings } from '../api/flexibilitySelection';

const defaults: SelectionSettings = {base_window_kind:'required', required_departure_time:null, default_soc_at_departure:null, default_cycle_id:null};
const sourceNames = {punctual:'Pontual', recurrent:'Base recorrente', forecast:'Forecast', equipment:'Configuração', requirement:'Requisito obrigatório'};
const fieldNames: Record<string,string> = {starts_at:'Início', ends_at:'Fim', soc_at_arrival:'SoC previsto à chegada', soc_at_departure:'Objetivo de carga', cycle:'Programa'};
const statuses = {resolved:'Oferta resolvida', incomplete:'Informação insuficiente', infeasible:'Requisito inviável', unavailable:'Indisponível', conflict:'Pedidos em conflito'};
const forecastNames: Record<string,string> = {usable:'Previsão válida', absent:'Sem previsão', disabled:'Previsão desativada', expired:'Previsão expirada', insufficient_data:'Sem histórico suficiente', failed:'Falha na previsão', settings_changed:'Previsão anterior à alteração das regras', not_yet_generated:'Previsão com data futura', wrong_semantics:'Previsão com significado incompatível', ambiguous:'Previsão sem associação inequívoca à ocorrência'};
const reasons: Record<string,string> = {
  occurrence_cancelled:'Esta ocorrência foi declarada indisponível.',
  forecast_refines_habit:'A previsão atualizou os horários habituais.', forecast_only:'Os horários vieram da previsão, com os valores configurados que forem necessários.',
  punctual_precedence:'O pedido pontual prevalece nesta ocorrência.', base_fallback:'Foi usada a base recorrente.',
  required_departure_preserved:'O prazo obrigatório foi preservado.', missing_departure_target:'Falta definir um objetivo de carga.',
  missing_time_window:'Falta um horário de início ou de fim.', missing_known_cycle:'Falta um programa conhecido com duração e consumo.',
  cycle_does_not_fit:'O programa não cabe na janela disponível. O ciclo não foi encurtado.',
  forecast_conflicts_with_requirement:'A previsão válida é incompatível com o prazo obrigatório. A base não foi usada para esconder o problema.',
  conflicting_declared_needs:'Há declarações incompatíveis para o mesmo equipamento.',
  forecast_ambiguous_for_need:'Não é possível associar a previsão inequivocamente a esta necessidade.',
  ambiguous_or_missing_required_local_time:'O prazo obrigatório cai numa hora inexistente ou ambígua; é necessária uma hora explícita.',
  energy_feasibility_not_evaluated:'Janela e objetivo definidos; a energia de carga realizável ainda depende dos dados físicos e do planeamento.',
};

export function FlexibilitySelection({assetId, assetName, kind, canEdit, from, until, actorId, cycles = []}: {
  actorId: string; assetId: string; assetName: string; kind: string; canEdit: boolean; from: string; until: string;
  cycles?: Array<{id:string;name:string}>;
}) {
  const [policy,setPolicy] = useState<SelectionPolicy|null>(null);
  const [settings,setSettings] = useState(defaults);
  const [forecastEnabled,setForecastEnabled] = useState(false);
  const [result,setResult] = useState<ChosenFlexibility|null>(null);
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  const [reload,setReload] = useState(0);
  const base = `/assets/${encodeURIComponent(assetId)}`;
  useEffect(()=>{
    const abort = new AbortController();
    setResult(null);setPolicy(null);setError('');setNotice('');
    Promise.all([
      selectionRequest<SelectionPolicy>(`${base}/policy`, {signal:abort.signal}),
      selectionRequest<ChosenFlexibility>(`${base}/selection?${new URLSearchParams({from,until})}`, {signal:abort.signal}),
    ]).then(([p,r])=>{if(!abort.signal.aborted){setPolicy(p);setSettings({...defaults,...p.settings.selection});setForecastEnabled(p.settings.forecast_enabled);setResult(r);}})
      .catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return ()=>abort.abort();
  },[base,from,until,reload]);
  const time = (value:string|null)=> value ? new Intl.DateTimeFormat('pt-PT',{timeZone:policy?.settings.timezone||'Europe/Lisbon',dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : 'Por determinar';
  const save = async(event:FormEvent)=>{
    event.preventDefault();if(!policy||!canEdit||busy)return;
    setBusy(true);setError('');setNotice('');setResult(null);
    try {
      const p = await selectionRequest<SelectionPolicy>(`${base}/policy`, {method:'PUT',body:JSON.stringify({expected_revision:policy.revision,settings:{...policy.settings, forecast_enabled:forecastEnabled, selection:settings}})});
      setPolicy(p);
      const r = await selectionRequest<ChosenFlexibility>(`${base}/selection`,{method:'POST',body:JSON.stringify({asset_ids:[assetId],from,until})});
      setResult(r);setNotice('Regras guardadas. Decisão do backend registada.');
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  };
  const occurrenceAction = async(offer:ChosenOffer, action: 'restore' | 'cancel')=>{
    if(!canEdit||!offer.event_id||busy)return;
    setBusy(true);setError('');
    try{
      await selectionRequest(`/events/${offer.event_id}/exceptions`, {method:'PUT',body:JSON.stringify({occurrence_at:offer.occurrence_at,action,expected_event_revision:offer.event_revision,expected_exception_revision:offer.exception_revision})});
      setReload(v=>v+1);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <section className="flex-selection" aria-label="Flexibilidade escolhida pelo backend" lang="pt-PT">
    <header><div><span className="eyebrow">ESCOLHA DO BACKEND</span><h2>{assetName}</h2></div><button type="button" className="btn" disabled={busy} onClick={()=>setReload(v=>v+1)}>Atualizar escolha</button></header>
    <p>Pontual → forecast válido → base. Os requisitos obrigatórios e o programa do equipamento são preservados.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!policy&&!error&&<p role="status">A obter regras e previsões guardadas no backend…</p>}
    {policy&&<details><summary>Hábitos e requisitos {canEdit?'· editar':'· consulta'}</summary>
      <form onSubmit={save}><fieldset disabled={!canEdit||busy}>
        <label>Significado dos horários da base<select value={settings.base_window_kind} onChange={e=>setSettings({...settings,base_window_kind:e.target.value as SelectionSettings['base_window_kind']})}>
          <option value="required">São limites obrigatórios</option><option value="habitual">São horários habituais; a previsão pode atualizá-los</option>
        </select></label>
        <p>Os pedidos antigos mantêm-se como limites obrigatórios até os alterar. Um pedido pontual continua a prevalecer.</p>
        {kind==='ev_charger'?<>
          <label>Preciso do carro até às · opcional<input type="time" value={settings.required_departure_time||''} onChange={e=>setSettings({...settings,required_departure_time:e.target.value||null})}/></label>
          <label>Objetivo de carga de recurso (%)<input type="number" min="0" max="100" step="1" value={settings.default_soc_at_departure===null?'':Math.round(settings.default_soc_at_departure*100)} onChange={e=>setSettings({...settings,default_soc_at_departure:e.target.value===''?null:Number(e.target.value)/100})}/></label>
          <p>Este prazo limita a base e a previsão no dia da saída. Um pedido pontual define o horário dessa ocorrência. O objetivo do pedido prevalece. Este valor só completa uma previsão sem pedido/base; não é o SoC previsto à chegada.</p>
        </>:<>
          <label>Programa de recurso · opcional<select value={settings.default_cycle_id||''} onChange={e=>setSettings({...settings,default_cycle_id:e.target.value||null})}><option value="">Sem programa de recurso</option>{cycles.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <p>A previsão estima períodos de utilização habitual. Não escolhe nem altera o ciclo; uma previsão de utilização não confirma que a máquina esteja pronta.</p>
        </>}
        <label className="flex-selection-check"><input type="checkbox" checked={forecastEnabled} onChange={e=>setForecastEnabled(e.target.checked)}/> Usar previsões válidas na escolha automática</label>
        {canEdit&&<button className="btn primary" type="submit">Guardar regras e recalcular</button>}
      </fieldset></form>
    </details>}
    {result&&<><p className="flex-selection-state">{forecastNames[result.forecast_state]||result.forecast_state} · horas em {policy?.settings.timezone||'Europe/Lisbon'}</p>
      {result.forecast&&<p className="footnote">Previsão simulada · {result.forecast.model_version} · gerada em {time(result.forecast.generated_at)} · válida até {time(result.forecast.valid_until)}</p>}
      {result.offers.length===0&&<p>Nenhuma oferta para este período. Ausência de informação não significa disponibilidade zero.</p>}
      {result.offers.map(offer=><article key={offer.need_id} className={`flex-selection-offer flex-selection-${offer.status}`}>
        <header><h3>{statuses[offer.status]}</h3>{offer.simulated&&<span>Inclui previsão simulada</span>}</header>
        <p className="flex-selection-window">{time(offer.starts_at)} → {time(offer.ends_at)}</p>
        {offer.soc_at_departure!==null&&<p>Objetivo à saída: {Math.round(offer.soc_at_departure*100)}%</p>}
        {offer.soc_at_arrival!==null&&<p>SoC previsto à chegada: {Math.round(offer.soc_at_arrival*100)}%</p>}
        {offer.cycle&&<p>{offer.cycle.name} · {offer.cycle.duration_minutes} min · {offer.cycle.energy_consumption_kwh} kWh</p>}
        {offer.latest_start&&<p>Último início que permite concluir o programa: {time(offer.latest_start)}</p>}
        {offer.semantics==='expected_usage'&&<p>Utilização esperada; não confirma disponibilidade para deslocar o ciclo ou prontidão física.</p>}
        <dl>{Object.entries(offer.origins).map(([field,origin])=><div key={field}><dt>{fieldNames[field]||field}</dt><dd>{sourceNames[origin.source]}{origin.revision!==null?` · revisão ${origin.revision}`:''}</dd></div>)}</dl>
        <ul>{offer.reasons.map(reason=><li key={reason}>{reasons[reason]||reason}</li>)}</ul>
        {!!offer.exception_revision&&offer.exception_action!=='restore'&&offer.event_id&&canEdit&&offer.created_by===actorId&&<button className="btn" type="button" disabled={busy} onClick={()=>occurrenceAction(offer,'restore')}>Remover exceção e regressar à base</button>}
        {offer.event_id&&offer.status!=='unavailable'&&canEdit&&offer.created_by===actorId&&<button className="btn text" type="button" disabled={busy} onClick={()=>occurrenceAction(offer,'cancel')}>Declarar indisponibilidade nesta ocorrência</button>}
      </article>)}
      <p className="footnote">Resultado calculado a partir dos dados guardados no backend. Não confirma execução física nem ligação ao predictor de Bernardo.</p>
    </>}
  </section>;
}
