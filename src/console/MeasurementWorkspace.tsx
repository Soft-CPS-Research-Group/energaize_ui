import { useMemo, useState } from 'react';
import { MeasurementChart, type MeasurementChartProps } from './MeasurementChart';
import { channelRequest, initialChannels, SERIES_COLORS, type MeasurementChannel } from './measurementChannels';
import { ChargerActivity } from './ChargerActivity';
import type { TimeWindow } from './measurementData';
export interface MeasurementWorkspaceProps extends MeasurementChartProps {
  channels: MeasurementChannel[];
  batteryEndpoint?: string;
  showChannelConfiguration?: boolean;
  onLinkChannel?: (id: string) => void;
  onUnlinkChannel?: (id: string) => void;
  onConfigureChannel?: (id: string) => void;
}
const batteryColors = {state_of_charge:'#5361a8',energy_in:'#12845a',energy_out:'#a34e30'};
export function MeasurementWorkspace(props: MeasurementWorkspaceProps) {
  const [selected, setSelected] = useState(() => initialChannels(props.channels));
  const [configuring, setConfiguring] = useState(false);
  const [window, setWindow] = useState<TimeWindow | null>(null);
  const linked = props.channels.filter(c => c.endpoint);
  const active = props.channels.filter(c => c.endpoint && selected.includes(c.id));
  const battery=!!props.batteryEndpoint;
  const key = active.map(c => c.id).sort().join(',');
  const request = useMemo(() => {
    const selected = channelRequest(battery ? linked : active, props.request);
    if (!props.batteryEndpoint) return selected;
    return (path:string, signal:AbortSignal) => path.endsWith('/latest') ? selected(path,signal)
      : props.request(props.batteryEndpoint+new URL(path,'http://console.local').search,signal);
  }, [key, props.request, props.channels, props.batteryEndpoint, battery]);
  const groups = new Map<string, MeasurementChannel[]>();
  props.channels.forEach(c => { const id = c.assetId || 'unassigned'; groups.set(id, [...(groups.get(id) || []), c]); });
  const label = (c: MeasurementChannel) => groups.size > 1 && c.assetName ? `${c.assetName} · ${c.title}` : c.title;
  const color=(c:MeasurementChannel)=>c.batteryLane ? batteryColors[c.batteryLane] : SERIES_COLORS[linked.indexOf(c) % SERIES_COLORS.length];
  const series = active.map(c => ({ ...c, title: label(c), color: color(c) }));
  const pendingFlow = battery ? (['energy_in','energy_out'] as const).filter(kind=>!linked.some(c=>c.batteryLane===kind)) : [];
  return <div className={battery?'telemetry-multiseries battery-chart':'telemetry-multiseries'}>
    <div className="telemetry-series-legend" role="group" aria-label="Visible measurements">
      {linked.map(c => <button key={c.id} aria-pressed={selected.includes(c.id)} onClick={() => setSelected(ids => ids.includes(c.id) ? ids.filter(id => id !== c.id) : [...ids, c.id])}>
        <i data-battery-lane={c.batteryLane} style={{ background: color(c) }} />{label(c)}<small>{c.unit || 'Unit unconfirmed'}</small>
      </button>)}
      {props.showChannelConfiguration !== false && props.channels.some(c => c.sourceKind !== 'derived') && <button className="telemetry-configure" onClick={() => setConfiguring(v => !v)} aria-expanded={configuring}>Measurement channels</button>}
    </div>
    <MeasurementChart {...props} forecastEndpoint={active.find(c=>c.forecastEndpoint)?.forecastEndpoint} forecastRequest={props.request} onWindowChange={props.activityEndpoint ? setWindow : props.onWindowChange} incremental={!battery && !active.some(c => c.incremental === false)} endpoint={linked.length ? '/selected/series' : undefined} latestEndpoint={linked.length ? '/selected/latest' : undefined}
      battery={battery} liveRefreshMs={battery?60000:props.liveRefreshMs}
      queryKey={key} series={series} request={request} title={battery?'Battery':active.length === 1 ? label(active[0]) : 'Selected measurements'}
      unit={active.length === 1 ? active[0].unit : undefined} note={active.map(c => c.note).filter(Boolean).join(' · ')}
      expectedSeconds={active.length ? Math.max(...active.map(c => c.expectedSeconds || 15)) : 15}
      onLink={props.onConfigureChannel || props.onLinkChannel ? () => setConfiguring(v => !v) : undefined} onUnlink={undefined} />
    {pendingFlow.length>0 && <p className="battery-chart-note">{pendingFlow.length===2?'Charge and discharge energy channels are pending.':pendingFlow[0]==='energy_in'?'Charge energy channel is pending.':'Discharge energy channel is pending.'}</p>}
    {props.activityEndpoint && <ChargerActivity endpoint={props.activityEndpoint} request={props.request} range={window} />}
    {configuring && <div className="telemetry-sensor-config">
      <p>Each channel measures one quantity from an equipment item. Collection settings and stored readings are configured separately.</p>
      {Array.from(groups, ([assetId, channels]) => <section key={assetId} aria-label={channels[0].assetName || 'Equipment not identified'}>
        <h3>{channels[0].assetName || 'Equipment not identified'}</h3>
        {channels.map(c => <div className="telemetry-channel-row" key={c.id}>
          <div className="telemetry-channel-description"><strong>{c.title}</strong>
            <small>{c.unit || 'Unit unconfirmed'} · {c.expectedSeconds ? `Every ${c.expectedSeconds} s` : 'Interval unconfirmed'} · {c.valueSemantics && c.valueSemantics !== 'unknown' ? c.valueSemantics : 'Value meaning unconfirmed'}</small>
            <small>{c.tag ? `Tag: ${c.tag}` : c.externalDeviceId ? `Device: ${c.externalDeviceId}` : 'Reference not assigned'}{c.sourceField ? ` → ${c.sourceField}` : ''} · {c.source ? `Source: ${c.source}` : 'Source not assigned'}</small>
          </div>
          <div className="telemetry-channel-state"><span>{(c.tag || (c.externalDeviceId && c.sourceField)) && c.source ? (c.enabled ? 'Enabled in catalogue' : 'Disabled in catalogue') : c.tag || c.source ? 'Collection setup incomplete' : 'Collection not configured'}</span><small>{c.simulated ? 'Local simulation connected' : c.endpoint ? 'Stored readings linked' : 'No stored readings linked'}</small></div>
          <div className="telemetry-channel-actions">
            {props.onConfigureChannel && <button onClick={() => props.onConfigureChannel?.(c.id)} aria-label={`Edit channel ${label(c)}`}>Edit channel</button>}
            {props.onLinkChannel && !c.simulated && <button onClick={() => props.onLinkChannel?.(c.id)} aria-label={`Link readings ${label(c)}`}>{c.endpoint ? 'Edit reading link' : 'Link readings'}</button>}
            {c.endpoint && props.onUnlinkChannel && <button onClick={() => props.onUnlinkChannel?.(c.id)} aria-label={`Unlink readings ${label(c)}`}>Unlink</button>}
          </div>
        </div>)}
      </section>)}
    </div>}

  </div>;
}
