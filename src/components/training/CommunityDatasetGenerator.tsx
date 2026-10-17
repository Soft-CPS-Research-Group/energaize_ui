import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { trainingRequest, trainingScopeUrl } from '../../api/trainingContext';

interface Channel { capability_id: string; name: string; unit: string; bound: boolean }
interface Site { id: string; name?: string; channels: Channel[] }
interface Selection { site_id: string; load_channel: string; solar_channel: string; price_channel: string }
export function CommunityDatasetGenerator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const inventory = useQuery({ queryKey: ['training-inventory'], queryFn: () => trainingRequest<{ sites: Site[] }>(trainingScopeUrl('/inventory')), enabled: open });
  const [name, setName] = useState('');
  const [from, setFrom] = useState(''); const [until, setUntil] = useState('');
  const [period, setPeriod] = useState(900);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [ack, setAck] = useState(false); const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<{ name: string; resource_id: string; warnings: string[] } | null>(null);
  const change = (site: string, field: keyof Selection, value: string) => { setSelections(old => ({ ...old, [site]: { ...old[site], [field]: value } })); setPreview(null); setAck(false); };
  const generate = useMutation({ mutationFn: (dry: boolean) => trainingRequest<Record<string, unknown>>(trainingScopeUrl('/datasets/generate'), { method: 'POST', body: JSON.stringify({ name, from_ts: new Date(from).toISOString(), until_ts: new Date(until).toISOString(), seconds_per_time_step: period, sites: Object.values(selections).map(s => ({ ...s, solar_channel: s.solar_channel || null })), acknowledge_electrical_only: ack, dry_run: dry }) }),
    onSuccess: (data, dry) => { if (dry) setPreview(data); else { setResult(data as unknown as typeof result); client.invalidateQueries({ queryKey: ['datasets'] }); client.invalidateQueries({ queryKey: ['training-resources', 'dataset'] }); } } });
  const config = useMutation({ mutationFn: () => trainingRequest(trainingScopeUrl(`/datasets/${result?.resource_id}/experiment-config`), { method: 'POST' }), onSuccess: () => client.invalidateQueries({ queryKey: ['configs'] }) });
  const valid = name.trim() && from && until && Object.values(selections).length > 0 && Object.values(selections).every(s => s.load_channel && s.price_channel);
  return <Modal title="Generate community dataset" open={open} onClose={onClose} width="lg"><div className="training-generator">
    <p>Select measured load, optional solar generation and price for each site. Times use your browser's local timezone.</p>
    <label>Name<input value={name} onChange={e => { setName(e.target.value); setPreview(null); }} /></label>
    <label>From<input type="datetime-local" value={from} onChange={e => { setFrom(e.target.value); setPreview(null); }} /></label>
    <label>Until<input type="datetime-local" value={until} onChange={e => { setUntil(e.target.value); setPreview(null); }} /></label>
    <label>Interval<select value={period} onChange={e => { setPeriod(Number(e.target.value)); setPreview(null); }}><option value={15}>15 seconds</option><option value={60}>1 minute</option><option value={900}>15 minutes</option><option value={3600}>1 hour</option></select></label>
    {inventory.isLoading && <p role="status">Loading sites and telemetry channels…</p>}
    {inventory.error && <p role="alert">{inventory.error.message}</p>}
    {inventory.data?.sites.map(site => <fieldset key={site.id}><legend><label><input type="checkbox" checked={Boolean(selections[site.id])} onChange={e => { setSelections(old => { const next = { ...old }; if (e.target.checked) next[site.id] = { site_id: site.id, load_channel: '', solar_channel: '', price_channel: '' }; else delete next[site.id]; return next; }); setPreview(null); }} />{site.name || site.id}</label></legend>
      {selections[site.id] && (['load_channel', 'solar_channel', 'price_channel'] as const).map(field => <label key={field}>{({ load_channel: 'Non-shiftable load', solar_channel: 'Solar generation (optional)', price_channel: 'Electricity price' })[field]}<select value={selections[site.id][field]} onChange={e => change(site.id, field, e.target.value)}><option value="">{field === 'solar_channel' ? 'Model without PV' : 'Select a bound channel'}</option>{site.channels.filter(c => c.bound).map(c => <option key={c.capability_id} value={c.capability_id}>{c.name} · {c.unit}</option>)}</select></label>)}
    </fieldset>)}
    <Button disabled={!valid || generate.isPending} onClick={() => generate.mutate(true)}>Review preparation</Button>
    {preview && <><ul>{(preview.assumptions as string[]).map(a => <li key={a}>{a}</li>)}</ul><label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I accept this electrical replay model and its documented simplifications.</label><Button variant="primary" disabled={!ack || generate.isPending || Boolean(result)} onClick={() => generate.mutate(false)}>{generate.isPending ? 'Generating…' : 'Generate dataset'}</Button></>}
    {generate.error && <p role="alert">{generate.error.message}</p>}
    {result && <div role="status"><p>Dataset {result.name} created.</p><Button disabled={config.isPending || config.isSuccess} onClick={() => config.mutate()}>{config.isSuccess ? 'Experiment config created' : 'Create baseline experiment config'}</Button></div>}
    {config.error && <p role="alert">{config.error.message}</p>}
  </div></Modal>;
}
