import { useEffect, useRef, useState } from 'react';
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
  market_enabled: boolean | null; grid_import_price: number | null; grid_export_price: number | null;
  community_buy_price: number | null; community_sell_price: number | null; description: string;
}
interface Defaults { options: Options; sites: House[]; timezone: string; community: { name: string; community_contracts?: unknown[] };
  suggested_period: { from_ts: string | null; until_ts: string | null }; problems: { message: string; site_id: string }[] }
interface Build { id: string; state: string; options: Options; report: { phase?: string; error?: string | { problems?: { message: string }[] }; warnings?: string[]; samples?: number; from_ts?: string; until_ts?: string; controlled_batteries?: number; result?: { name: string; version: number }; validation?: { ok: boolean } } }
const terminal = new Set(['completed', 'failed', 'ready']);
const signalLabels: Record<string, string> = { load: 'Consumo não flexível', grid_import: 'Importação da rede', grid_export: 'Exportação para a rede', solar: 'Produção solar', price: 'Preço de compra', battery_in: 'Carga histórica da bateria', battery_out: 'Descarga histórica da bateria', soc: 'Estado de carga da bateria' };
const priceLabels = { grid_import_price: 'Compra à rede', grid_export_price: 'Venda à rede', community_buy_price: 'Compra na comunidade', community_sell_price: 'Venda na comunidade' } as const;
const dateLabel = (value?: string | null, zone = 'UTC') => value ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: zone }).format(new Date(value)) : 'Por determinar';

export function CommunityDatasetGenerator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { id } = useTrainingWorkspace();
  return <Modal title="Gerar dataset da comunidade" open={open} onClose={onClose} width="lg">{open && <Generator key={id} workspaceId={id} />}</Modal>;
}

function Generator({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const url = `/api/training/workspaces/${encodeURIComponent(workspaceId)}/datasets`;
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
  }, onSuccess: data => { requestIdentity.current = null; setBuildId(data.id); client.invalidateQueries({ queryKey: ['dataset-builds', workspaceId] }); } });
  const publish = useMutation({ mutationFn: () => trainingRequest<Build>(url + '/builds/' + buildId + '/publish', { method: 'POST' }), onSuccess: data => client.setQueryData(['dataset-build', workspaceId, buildId], data) });
  const change = <K extends keyof Options>(key: K, value: Options[K]) => { setOptions(previous => previous && { ...previous, [key]: value }); setBuildId(null); };
  const busy = create.isPending || publish.isPending || (!!buildId && (!build.data || !terminal.has(build.data.state)));
  const report = build.data?.report;
  const error = report?.error;
  if (defaults.isLoading) return <p role="status">A preparar as escolhas a partir da comunidade e dos dados disponíveis…</p>;
  if (defaults.error) return <div role="alert"><p>{defaults.error.message}</p><Button onClick={() => defaults.refetch()}>Tentar novamente</Button></div>;
  if (!defaults.data || !options) return null;
  const data = defaults.data;
  return <div className="training-generator community-dataset-generator">
    <p>Todas as casas e equipamentos estão selecionados. A configuração vem da comunidade; podes gerar diretamente ou ajustar as opções abaixo.</p>
    <div className="dataset-generation-summary">
      <strong>{data.community.name}</strong>
      <span>{options.site_ids.length} casas · {options.asset_ids.filter(a => data.sites.some(h => options.site_ids.includes(h.site.id) && h.assets.some(v => v.id === a))).length} equipamentos</span>
      <span>{dateLabel(data.suggested_period.from_ts, data.timezone)} — {dateLabel(data.suggested_period.until_ts, data.timezone)} · {data.timezone}</span>
      <span>Intervalo: {options.seconds_per_time_step < 60 ? `${options.seconds_per_time_step} segundos` : `${options.seconds_per_time_step / 60} minutos`} · Tarifas e parâmetros herdados</span>
    </div>
    <label>Nome do dataset<input value={options.name} disabled={busy} onChange={e => change('name', e.target.value)} /></label>
    <details><summary>Casas e equipamentos</summary>
      <fieldset disabled={busy}>
      {data.sites.map(house => <div className="dataset-house" key={house.site.id}>
        <label><input type="checkbox" checked={options.site_ids.includes(house.site.id)} onChange={e => change('site_ids', e.target.checked ? [...options.site_ids, house.site.id] : options.site_ids.filter(v => v !== house.site.id))} />{house.site.name || house.site.id}</label>
        {house.assets.map(asset => <label key={asset.id}><input type="checkbox" disabled={!options.site_ids.includes(house.site.id)} checked={options.asset_ids.includes(asset.id)} onChange={e => change('asset_ids', e.target.checked ? [...options.asset_ids, asset.id] : options.asset_ids.filter(v => v !== asset.id))} />{asset.data.name || asset.asset_type}<small>{asset.asset_type}</small></label>)}
      </div>)}
      </fieldset>
    </details>
    <details><summary>Período e resolução</summary><fieldset disabled={busy}>
      <p>Por defeito é escolhido o maior período comum completo disponível, até um ano. As alterações de datas abaixo usam UTC; o calendário da simulação usa {data.timezone}.</p>
      <label>Início (UTC)<input type="datetime-local" value={options.from_ts?.slice(0, 16) || ''} onChange={e => change('from_ts', e.target.value ? e.target.value + ':00Z' : null)} /></label>
      <label>Fim exclusivo (UTC)<input type="datetime-local" value={options.until_ts?.slice(0, 16) || ''} onChange={e => change('until_ts', e.target.value ? e.target.value + ':00Z' : null)} /></label>
      <label>Intervalo em segundos<input type="number" min={1} max={3600} value={options.seconds_per_time_step} onChange={e => change('seconds_per_time_step', Number(e.target.value))} /></label>
    </fieldset></details>
    <details><summary>Simulação e tarifas</summary><fieldset disabled={busy}>
      <p>As alterações aplicam-se apenas a este cenário. As baterias usam as características registadas e o estado de carga medido no início. Outros consumos permanecem nas séries medidas quando não existe um modelo independente.</p>
      <label>Mercado interno<select value={options.market_enabled === null ? 'inherit' : String(options.market_enabled)} onChange={e => change('market_enabled', e.target.value === 'inherit' ? null : e.target.value === 'true')}><option value="inherit">Da comunidade</option><option value="true">Ativado</option><option value="false">Desativado</option></select></label>
      {(Object.keys(priceLabels) as (keyof typeof priceLabels)[]).map(key => <label key={key}>{priceLabels[key]} (€/kWh)<input type="number" step="any" placeholder="Da comunidade / fonte de preços" value={options[key] ?? ''} onChange={e => change(key, e.target.value === '' ? null : Number(e.target.value))} /></label>)}
      {data.sites.filter(h => options.site_ids.includes(h.site.id)).flatMap(h => h.assets).filter(a => a.asset_type === 'battery' && options.asset_ids.includes(a.id)).map(a => <label key={a.id}>SOC inicial · {a.data.name || 'Bateria'} (0–1)<input type="number" min={0} max={1} step="0.01" placeholder="Medição no início do período" value={options.battery_initial_soc[a.id] ?? ''} onChange={e => { const next = { ...options.battery_initial_soc }; if (e.target.value === '') delete next[a.id]; else next[a.id] = Number(e.target.value); change('battery_initial_soc', next); }} /></label>)}
    </fieldset></details>
    <details><summary>Fontes de dados</summary><fieldset disabled={busy}>
      <p>O mapeamento é automático quando a origem é inequívoca. Seleciona uma alternativa apenas quando necessário.</p>
      {data.sites.filter(h => options.site_ids.includes(h.site.id)).map(house => <details key={house.site.id}><summary>{house.site.name}</summary>
        {Object.entries(signalLabels).map(([key, label]) => <label key={key}>{label}<select value={options.signals[house.site.id]?.[key] ?? ''} onChange={e => { const next = { ...options.signals[house.site.id] }; if (e.target.value) next[key] = e.target.value; else delete next[key]; change('signals', { ...options.signals, [house.site.id]: next }); }}>
          <option value="">Automático{house.signals[key] ? ` · ${house.channels.find(c => c.capability_id === house.signals[key])?.name || ''}` : ''}</option>
          {house.channels.filter(c => c.bound).map(c => <option key={c.capability_id} value={c.capability_id}>{c.name} · {c.unit}</option>)}
        </select></label>)}
      </details>)}
    </fieldset></details>
    {data.problems.length > 0 && <details><summary>Informação a completar na seleção inicial ({data.problems.length})</summary><ul>{data.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul><p>A geração volta a verificar as escolhas atuais.</p></details>}
    <div className="training-actions"><Button disabled={busy || !options.site_ids.length || !options.name.trim()} onClick={() => create.mutate(false)}>Verificar dados</Button><Button variant="primary" disabled={busy || !options.site_ids.length || !options.name.trim()} onClick={() => build.data?.state === 'ready' ? publish.mutate() : create.mutate(true)}>{busy ? 'A preparar…' : 'Gerar dataset'}</Button></div>
    {create.error && <p role="alert">{create.error.message}</p>}
    {build.error && <p role="alert">{build.error.message}</p>}
    {build.data && <div className="dataset-build-status" role="status"><strong>{report?.result ? `Dataset ${report.result.name} disponível` : report?.phase || build.data.state}</strong>
      {report?.samples && <p>{report.samples} intervalos · {report.controlled_batteries || 0} baterias controláveis · {dateLabel(report.from_ts, data.timezone)} — {dateLabel(report.until_ts, data.timezone)}</p>}
      {error && <div role="alert">{typeof error === 'string' ? error : <ul>{error.problems?.map((p, i) => <li key={i}>{p.message}</li>)}</ul>}</div>}
      {!!report?.warnings?.length && <details><summary>Pressupostos e capacidades</summary><ul>{report.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
      {build.data.state === 'ready' && <Button variant="primary" disabled={publish.isPending} onClick={() => publish.mutate()}>Guardar esta versão validada</Button>}
      {publish.error && <p role="alert">{publish.error.message}</p>}
      {build.data.state === 'completed' && <p>Guardado no servidor e disponível na lista de datasets. Escolhe o algoritmo e os jobs na configuração da experiência.</p>}
    </div>}
    {!!history.data?.length && <details><summary>Gerações recentes</summary>{history.data.map(b => <button type="button" className="btn btn-ghost btn-sm" key={b.id} onClick={() => { setBuildId(b.id); setOptions(b.options); }}>{b.report.result?.name || b.options.name} · {b.state}</button>)}</details>}
  </div>;
}
