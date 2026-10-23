import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Home, SlidersHorizontal } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { trainingRequest } from '../../api/trainingContext';
import { useTrainingWorkspace } from '../../contexts/TrainingWorkspaceContext';

interface Channel { capability_id: string; name: string; unit: string; bound: boolean }
interface Asset { id: string; asset_type: string; data: { name?: string } }
interface House { site: { id: string; name?: string }; assets: Asset[]; channels: Channel[]; signals: Record<string, string | null> }
interface Options {
  name: string; site_ids: string[]; asset_ids: string[]; from_ts: string | null; until_ts: string | null;
  seconds_per_time_step: number; signals: Record<string, Record<string, string>>; battery_initial_soc: Record<string, number>;
  ev_initial_soc?: Record<string, number>;
  market_enabled: boolean | null; grid_import_price: number | null; grid_export_price: number | null;
  community_buy_price: number | null; community_sell_price: number | null; description: string;
}
interface Defaults { options: Options; sites: House[]; timezone: string; community: { name: string; community_contracts?: unknown[] };
  suggested_period: { from_ts: string | null; until_ts: string | null }; problems: { message: string; site_id: string }[] }
interface Build { id: string; state: string; options: Options; report: { phase?: string; error?: string | { problems?: { message: string }[] }; warnings?: string[]; samples?: number; from_ts?: string; until_ts?: string; controlled_batteries?: number; controlled_evs?: number; controlled_chargers?: number; controlled_appliances?: number; result?: { name: string; version: number }; validation?: { ok: boolean } } }
const terminal = new Set(['completed', 'failed', 'ready']);
const signalLabels: Record<string, string> = { load: 'Consumo não flexível', grid_import: 'Importação da rede', grid_export: 'Exportação para a rede', solar: 'Produção solar', price: 'Preço de compra', battery_in: 'Carga histórica da bateria', battery_out: 'Descarga histórica da bateria', soc: 'Estado de carga da bateria' };
const steps = ['Comunidade', 'Simulação', 'Rever e gerar'];
const assetLabels: Record<string, string> = { battery: 'Bateria', pv_system: 'Produção solar', grid_meter: 'Contador', ev_charger: 'Carregador', ev: 'Veículo elétrico', electric_vehicle: 'Veículo elétrico', non_shiftable_load: 'Consumo', appliance: 'Equipamento', shiftable_load: 'Carga flexível', heat_pump: 'Bomba de calor' };
const stateLabels: Record<string, string> = { queued: 'Em espera', preparing: 'A preparar os dados', validating: 'A validar a simulação', publishing: 'A guardar no servidor', completed: 'Concluído', failed: 'Não foi possível gerar', ready: 'Dados verificados — prontos a guardar' };
const priceLabels = { grid_import_price: 'Compra à rede', grid_export_price: 'Venda à rede', community_buy_price: 'Compra na comunidade', community_sell_price: 'Venda na comunidade' } as const;
const dateLabel = (value?: string | null, zone = 'UTC') => value ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: zone }).format(new Date(value)) : 'Por determinar';

export function CommunityDatasetGenerator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { id } = useTrainingWorkspace();
  return <Modal title="Gerar dataset da comunidade" open={open} onClose={onClose} width="lg">{open && <Generator key={id} workspaceId={id} />}</Modal>;
}

function Generator({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const url = `/api/training/workspaces/${encodeURIComponent(workspaceId)}/datasets`;
  const [step, setStep] = useState(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [editingSelection, setEditingSelection] = useState(false);
  useEffect(() => { stepHeading.current?.focus(); }, [step]);
  const [options, setOptions] = useState<Options | null>(null);
  const requestIdentity = useRef<{ fingerprint: string; key: string } | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const defaults = useQuery({ queryKey: ['dataset-defaults', workspaceId], queryFn: () => trainingRequest<Defaults>(url + '/defaults'), retry: false });
  const history = useQuery({ queryKey: ['dataset-builds', workspaceId], queryFn: () => trainingRequest<Build[]>(url + '/builds') });
  useEffect(() => { if (defaults.data && !options) setOptions(defaults.data.options); }, [defaults.data, options]);
  const build = useQuery({ queryKey: ['dataset-build', workspaceId, buildId], queryFn: () => trainingRequest<Build>(url + '/builds/' + buildId), enabled: !!buildId,
    refetchInterval: query => query.state.data && terminal.has(query.state.data.state) ? false : 1500 });
  useEffect(() => {
    if (build.data?.state === 'completed') {
      client.invalidateQueries({ queryKey: ['datasets'] });
      client.invalidateQueries({ queryKey: ['training-resources', 'dataset'] });
      client.invalidateQueries({ queryKey: ['dataset-builds', workspaceId] });
    }
  }, [build.data?.state, client, workspaceId]);
  const create = useMutation({ mutationFn: (generate: boolean) => {
    if (!options) throw new Error('A configuração ainda não foi carregada.');
    const selected = new Set(options.site_ids);
    const owned = new Set(defaults.data?.sites.filter(h => selected.has(h.site.id)).flatMap(h => h.assets.map(a => a.id)));
    const selectedOptions = { ...options, asset_ids: options.asset_ids.filter(a => owned.has(a)) };
    const fingerprint = JSON.stringify({ options: selectedOptions, generate });
    if (requestIdentity.current?.fingerprint !== fingerprint) requestIdentity.current = { fingerprint, key: crypto.randomUUID() };
    return trainingRequest<Build>(url + '/builds', { method: 'POST', body: JSON.stringify({ options: selectedOptions, generate, idempotency_key: requestIdentity.current.key }) });
  }, onSuccess: data => { requestIdentity.current = null; setBuildId(data.id); setStep(2); client.invalidateQueries({ queryKey: ['dataset-builds', workspaceId] }); } });
  const publish = useMutation({ mutationFn: () => trainingRequest<Build>(url + '/builds/' + buildId + '/publish', { method: 'POST' }), onSuccess: data => client.setQueryData(['dataset-build', workspaceId, buildId], data) });
  const change = <K extends keyof Options>(key: K, value: Options[K]) => { setOptions(previous => previous && { ...previous, [key]: value }); setBuildId(null); create.reset(); publish.reset(); };
  const busy = create.isPending || publish.isPending || (!!buildId && (!build.data || !terminal.has(build.data.state)));
  const report = build.data?.report;
  const error = report?.error;
  if (defaults.isLoading) return <p role="status">A preparar as escolhas a partir da comunidade e dos dados disponíveis…</p>;
  if (defaults.error) return <div role="alert"><p>{defaults.error.message}</p><Button onClick={() => defaults.refetch()}>Tentar novamente</Button></div>;
  if (!defaults.data || !options) return null;
  const data = defaults.data;
  const selectedHouses = data.sites.filter(h => options.site_ids.includes(h.site.id));
  const selectedAssets = selectedHouses.flatMap(h => h.assets).filter(a => options.asset_ids.includes(a.id));
  const batteries = selectedAssets.filter(a => a.asset_type === 'battery');
  const vehicles = [...new Map(selectedAssets.filter(a => a.asset_type === 'ev').map(a => [a.id, a])).values()];
  const selectedProblems = data.problems.filter(p => options.site_ids.includes(p.site_id));
  const valid = !!options.site_ids.length && !!options.name.trim();
  const period = options.from_ts || options.until_ts
    ? `${dateLabel(options.from_ts || data.suggested_period.from_ts, data.timezone)} — ${dateLabel(options.until_ts || data.suggested_period.until_ts, data.timezone)}`
    : 'Maior período comum disponível';
  const interval = options.seconds_per_time_step < 60 ? `${options.seconds_per_time_step} segundos` : `${options.seconds_per_time_step / 60} minutos`;
  const toggleAsset = (assetId: string, checked: boolean) => change('asset_ids', checked ? [...options.asset_ids, assetId] : options.asset_ids.filter(v => v !== assetId));
  return <div className="training-generator community-dataset-generator">
    <nav className="dataset-steps" aria-label="Passos da geração">
      {steps.map((label, index) => <button type="button" key={label}
        className={`dataset-step-link ${index === step ? 'is-active' : index < step ? 'is-done' : ''}`}
        aria-current={index === step ? 'step' : undefined} disabled={busy || (index > step && !valid)} onClick={() => setStep(index)}>
        <span className="dataset-step-number">{index < step ? <Check size={14} aria-hidden="true" /> : index + 1}</span><span>{label}</span>
      </button>)}
    </nav>
    <div className="dataset-workspace-line"><Home size={16} aria-hidden="true" /><strong>{data.community.name}</strong><span>{options.site_ids.length} casas · {selectedAssets.length} equipamentos</span></div>

    <section className="dataset-step-content" key={step} aria-labelledby="dataset-step-title">
      <header className="dataset-step-heading">
        <small>PASSO {step + 1} DE 3</small>
        <h2 id="dataset-step-title" ref={stepHeading} tabIndex={-1}>{['Escolher o que incluir', 'Preparar a simulação', 'Rever e gerar o dataset'][step]}</h2>
        <p>{['Todas as casas e equipamentos vêm selecionados por defeito.', 'Os dados e a configuração da comunidade preenchem as escolhas por ti.', 'Confirma o cenário. A geração valida os dados e guarda uma versão no servidor.'][step]}</p>
      </header>

      {step === 0 && <>
        <label>Nome do dataset<input value={options.name} disabled={busy} onChange={e => change('name', e.target.value)} /></label>
        <div className="dataset-section-heading"><div><h3>Casas e equipamentos</h3><p>{options.site_ids.length === data.sites.length ? 'Todas as casas selecionadas' : `${options.site_ids.length} de ${data.sites.length} casas selecionadas`}</p></div>
          <Button variant="ghost" size="sm" iconLeft={<SlidersHorizontal size={15} />} aria-expanded={editingSelection} onClick={() => setEditingSelection(!editingSelection)}>{editingSelection ? 'Concluir seleção' : 'Alterar seleção'}</Button>
        </div>
        {editingSelection ? <fieldset disabled={busy} className="dataset-house-list">
          <div className="dataset-selection-tools"><Button variant="ghost" size="sm" onClick={() => { setOptions({ ...options, site_ids: data.sites.map(h => h.site.id), asset_ids: data.sites.flatMap(h => h.assets.map(a => a.id)) }); setBuildId(null); }}>Selecionar tudo</Button></div>
          {data.sites.map(house => <div className="dataset-house" key={house.site.id}>
            <div className="dataset-house-row"><label><input type="checkbox" checked={options.site_ids.includes(house.site.id)} onChange={e => change('site_ids', e.target.checked ? [...options.site_ids, house.site.id] : options.site_ids.filter(v => v !== house.site.id))} /><strong>{house.site.name || 'Casa'}</strong></label><small>{house.assets.filter(a => options.asset_ids.includes(a.id)).length} / {house.assets.length} equipamentos</small></div>
            {house.assets.length > 0 && options.site_ids.includes(house.site.id) && <details className="dataset-equipment"><summary>Escolher equipamentos <ChevronDown size={14} aria-hidden="true" /></summary><div className="dataset-equipment-list">
              {house.assets.map(asset => <label key={asset.id}><input type="checkbox" checked={options.asset_ids.includes(asset.id)} onChange={e => toggleAsset(asset.id, e.target.checked)} /><span>{asset.data.name || assetLabels[asset.asset_type] || 'Equipamento'}<small>{assetLabels[asset.asset_type] || 'Equipamento'}</small></span></label>)}
            </div></details>}
          </div>)}
        </fieldset> : <div className="dataset-house-overview">{selectedHouses.map(house => <div key={house.site.id}><Home size={16} aria-hidden="true" /><span>{house.site.name || 'Casa'}</span><small>{house.assets.filter(a => options.asset_ids.includes(a.id)).length} equipamentos</small><Check size={15} aria-label="Selecionada" /></div>)}</div>}
        {!options.site_ids.length && <p role="alert">Seleciona pelo menos uma casa para continuar.</p>}
      </>}

      {step === 1 && <>
        <dl className="dataset-review-list">
          <div><dt>Período</dt><dd>{period}</dd></div>
          <div><dt>Resolução</dt><dd>{interval}</dd></div>
          <div><dt>Baterias</dt><dd>{batteries.length ? `${batteries.length} · características registadas na comunidade` : 'Sem baterias selecionadas'}</dd></div>
          <div><dt>Tarifas e mercado</dt><dd>{Object.keys(priceLabels).some(k => options[k as keyof typeof priceLabels] !== null) || options.market_enabled !== null ? 'Com ajustes para este cenário' : 'Da configuração da comunidade'}</dd></div>
          <div><dt>Veículos e equipamentos</dt><dd>Sessões, características e ciclos registados na comunidade</dd></div>
          <div><dt>Previsões de preço</dt><dd>Horizontes guardados em cada instante · 1, 2 e 3 horas</dd></div>
        </dl>
        <details className="dataset-options"><summary>Período e resolução <ChevronDown size={16} aria-hidden="true" /></summary><fieldset disabled={busy}>
          <p>O período automático usa o maior segmento comum completo, até um ano e dentro do limite de extração. As datas abaixo usam UTC; a simulação usa {data.timezone}.</p>
          <div className="dataset-field-grid"><label>Início (UTC)<input type="datetime-local" value={options.from_ts?.slice(0, 16) || ''} onChange={e => change('from_ts', e.target.value ? e.target.value + ':00Z' : null)} /></label>
          <label>Fim exclusivo (UTC)<input type="datetime-local" value={options.until_ts?.slice(0, 16) || ''} onChange={e => change('until_ts', e.target.value ? e.target.value + ':00Z' : null)} /></label></div>
          <label>Intervalo em segundos<input type="number" min={1} max={3600} value={options.seconds_per_time_step} onChange={e => change('seconds_per_time_step', Number(e.target.value))} /></label>
        </fieldset></details>
        <details className="dataset-options"><summary>Simulação e tarifas <ChevronDown size={16} aria-hidden="true" /></summary><fieldset disabled={busy}>
          <p>Os ajustes aplicam-se apenas a este dataset. Campos vazios mantêm a configuração da comunidade.</p>
          <label>Mercado interno<select value={options.market_enabled === null ? 'inherit' : String(options.market_enabled)} onChange={e => change('market_enabled', e.target.value === 'inherit' ? null : e.target.value === 'true')}><option value="inherit">Da comunidade</option><option value="true">Ativado</option><option value="false">Desativado</option></select></label>
          <div className="dataset-field-grid">{(Object.keys(priceLabels) as (keyof typeof priceLabels)[]).filter(key => options.market_enabled !== false || !key.startsWith('community_')).map(key => <label key={key}>{priceLabels[key]} (€/kWh)<input type="number" step="any" placeholder="Da comunidade" value={options[key] ?? ''} onChange={e => change(key, e.target.value === '' ? null : Number(e.target.value))} /></label>)}</div>
          {batteries.length > 0 && <p>As baterias usam as características registadas e o estado de carga medido no início do período.</p>}
          {batteries.map(a => <label key={a.id}>Carga inicial · {a.data.name || 'Bateria'} (0–1)<input type="number" min={0} max={1} step="0.01" placeholder="Medição no início do período" value={options.battery_initial_soc[a.id] ?? ''} onChange={e => { const next = { ...options.battery_initial_soc }; if (e.target.value === '') delete next[a.id]; else next[a.id] = Number(e.target.value); change('battery_initial_soc', next); }} /></label>)}
          {selectedAssets.some(a => a.asset_type === 'ev_charger') && <p>Os veículos usam a ligação ao carregador e a flexibilidade guardadas em cada instante. Previsões alteradas ou apagadas mantêm esse histórico; campos vazios ficam como desconhecidos.</p>}
          {vehicles.map(a => <label key={a.id}>Carga inicial · {a.data.name || 'Veículo elétrico'} (0–1)<input type="number" min={0} max={1} step="0.01" placeholder="Medição no início do período" value={options.ev_initial_soc?.[a.id] ?? ''} onChange={e => { const next = { ...options.ev_initial_soc }; if (e.target.value === '') delete next[a.id]; else next[a.id] = Number(e.target.value); change('ev_initial_soc', next); }} /></label>)}
          <p>Quando falta um horizonte de preço, usa-se o preço conhecido nesse instante. O relatório indica essa cobertura. A simulação não envia comandos para os equipamentos reais.</p>
        </fieldset></details>
        <details className="dataset-options"><summary>Rever fontes de dados <ChevronDown size={16} aria-hidden="true" /></summary><fieldset disabled={busy}>
          <p>As séries são identificadas automaticamente na configuração existente. Só é necessário escolher uma origem quando a correspondência está em falta ou é ambígua.</p>
          {selectedHouses.map(house => <details className="dataset-source-house" key={house.site.id}><summary>{house.site.name || 'Casa'} <ChevronDown size={14} aria-hidden="true" /></summary><div className="dataset-field-grid">
            {Object.entries(signalLabels).filter(([key]) => !['soc', 'battery_in', 'battery_out'].includes(key) || house.assets.some(a => a.asset_type === 'battery')).filter(([key]) => key !== 'solar' || house.assets.some(a => a.asset_type === 'pv_system')).map(([key, label]) => <label key={key}>{label}<select value={options.signals[house.site.id]?.[key] ?? ''} onChange={e => { const next = { ...options.signals[house.site.id] }; if (e.target.value) next[key] = e.target.value; else delete next[key]; change('signals', { ...options.signals, [house.site.id]: next }); }}>
              <option value="">Automático{house.signals[key] ? ` · ${house.channels.find(c => c.capability_id === house.signals[key])?.name || ''}` : ''}</option>
              {house.channels.filter(c => c.bound).map(c => <option key={c.capability_id} value={c.capability_id}>{c.name} · {c.unit}</option>)}
            </select></label>)}
          </div></details>)}
        </fieldset></details>
      </>}

      {step === 2 && <>
        <dl className="dataset-review-list">
          <div><dt>Dataset</dt><dd>{options.name}</dd></div>
          <div><dt>Incluído</dt><dd>{options.site_ids.length} casas · {selectedAssets.length} equipamentos</dd></div>
          <div><dt>Período</dt><dd>{period}<small>Intervalos de {interval} · {data.timezone}</small></dd></div>
          <div><dt>Armazenamento</dt><dd>Servidor · workspace de {data.community.name}<small>Nova versão com dados e configuração da comunidade</small></dd></div>
        </dl>
        {!!selectedProblems.length && !build.data && <div className="dataset-attention"><strong>Há informação a confirmar</strong><p>A seleção inicial tem {selectedProblems.length} indicações. A verificação volta a avaliar os teus ajustes.</p><details><summary>Ver indicações <ChevronDown size={14} aria-hidden="true" /></summary><ul>{selectedProblems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></details></div>}
        {!build.data && <p className="dataset-footnote">São recolhidas as séries do período escolhido. Algoritmos e jobs são configurados depois.</p>}
        {create.error && <p role="alert">{create.error.message}</p>}
        {build.error && <p role="alert">{build.error.message}</p>}
        {build.data && <div className="dataset-build-status" role="status"><strong>{report?.result ? `Dataset ${report.result.name} disponível` : stateLabels[build.data.state] || 'A processar'}</strong>
          {busy && <p>Podes fechar esta janela. A preparação continua no servidor.</p>}
          {!!report?.samples && <p>{report.samples} intervalos · {report.controlled_batteries || 0} baterias · {report.controlled_evs || 0} veículos · {report.controlled_chargers || 0} carregadores · {report.controlled_appliances || 0} aparelhos controláveis · {dateLabel(report.from_ts, data.timezone)} — {dateLabel(report.until_ts, data.timezone)}</p>}
          {error && <div role="alert">{typeof error === 'string' ? error : <ul>{error.problems?.map((p, i) => <li key={i}>{p.message}</li>)}</ul>}</div>}
          {!!report?.warnings?.length && <details><summary>Pressupostos e capacidades <ChevronDown size={14} aria-hidden="true" /></summary><ul>{report.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
          {publish.error && <p role="alert">{publish.error.message}</p>}
          {build.data.state === 'completed' && <p>Guardado no servidor e disponível na lista de datasets.</p>}
        </div>}
      </>}
    </section>

    <footer className="training-actions">
      {step > 0 ? <Button variant="ghost" disabled={busy} iconLeft={<ArrowLeft size={16} />} onClick={() => setStep(step - 1)}>Voltar</Button> : <Button variant="ghost" disabled={!valid || busy} onClick={() => setStep(2)}>Usar predefinições</Button>}
      <div>{step < 2 ? <Button variant="primary" disabled={!valid || busy} iconRight={<ArrowRight size={16} />} onClick={() => setStep(step + 1)}>Continuar</Button> : <>
        {!busy && !['ready', 'completed'].includes(build.data?.state || '') && <Button disabled={!valid} onClick={() => create.mutate(false)}>Verificar dados</Button>}
        {build.data?.state === 'completed' ? <Button onClick={() => { setBuildId(null); setStep(0); }}>Preparar outro dataset</Button> : <Button variant="primary" disabled={busy || !valid} onClick={() => build.data?.state === 'ready' ? publish.mutate() : create.mutate(true)}>{busy ? 'A preparar…' : build.data?.state === 'ready' ? 'Guardar versão validada' : 'Gerar dataset'}</Button>}
      </>}</div>
    </footer>
    {!!history.data?.length && <details className="dataset-history"><summary>Gerações recentes <ChevronDown size={14} aria-hidden="true" /></summary>{history.data.map(b => <button type="button" disabled={busy} key={b.id} onClick={() => { setBuildId(b.id); setOptions(b.options); setStep(2); }}><span>{b.report.result?.name || b.options.name}</span><small>{stateLabels[b.state] || b.state}</small></button>)}</details>}
  </div>;
}
