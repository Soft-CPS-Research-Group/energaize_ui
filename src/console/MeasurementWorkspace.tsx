import { useMemo, useState } from 'react';
import { MeasurementChart, type MeasurementChartProps } from './MeasurementChart';
import { channelRequest, initialChannels, SERIES_COLORS, type MeasurementChannel } from './measurementChannels';
export interface MeasurementWorkspaceProps extends MeasurementChartProps {
  channels: MeasurementChannel[];
  showChannelConfiguration?: boolean;
  onLinkChannel?: (id: string) => void;
  onUnlinkChannel?: (id: string) => void;
  onConfigureChannel?: (id: string) => void;
}
export function MeasurementWorkspace(props: MeasurementWorkspaceProps) {
  const [selected, setSelected] = useState(() => initialChannels(props.channels));
  const [configuring, setConfiguring] = useState(false);
  const linked = props.channels.filter(c => c.endpoint);
  const active = props.channels.filter(c => c.endpoint && selected.includes(c.id));
  const key = active.map(c => c.id).sort().join(',');
  const request = useMemo(() => channelRequest(active, props.request), [key, props.request, props.channels]);
  const groups = new Map<string, MeasurementChannel[]>();
  props.channels.forEach(c => { const id = c.assetId || 'unassigned'; groups.set(id, [...(groups.get(id) || []), c]); });
  const label = (c: MeasurementChannel) => groups.size > 1 && c.assetName ? `${c.assetName} · ${c.title}` : c.title;
  const series = active.map(c => ({ ...c, title: label(c), color: SERIES_COLORS[linked.findIndex(v => v.id === c.id) % SERIES_COLORS.length] }));
  return <div className="telemetry-multiseries">
    <MeasurementChart {...props} incremental={!active.some(c => c.incremental === false)} endpoint={linked.length ? '/selected/series' : undefined} latestEndpoint={linked.length ? '/selected/latest' : undefined}
      queryKey={key} series={series} request={request} title={active.length === 1 ? label(active[0]) : 'Selected measurements'}
      unit={active.length === 1 ? active[0].unit : undefined} note={active.map(c => c.note).filter(Boolean).join(' · ')}
      expectedSeconds={active.length ? Math.max(...active.map(c => c.expectedSeconds || 15)) : 15}
      onLink={props.onConfigureChannel || props.onLinkChannel ? () => setConfiguring(v => !v) : undefined} onUnlink={undefined} />
    <div className="telemetry-series-legend" role="group" aria-label="Visible measurements">
      {linked.map(c => <button key={c.id} aria-pressed={selected.includes(c.id)} onClick={() => setSelected(ids => ids.includes(c.id) ? ids.filter(id => id !== c.id) : [...ids, c.id])}>
        <i style={{ background: SERIES_COLORS[linked.findIndex(v => v.id === c.id) % SERIES_COLORS.length] }} />{label(c)}<small>{c.unit || 'Unit unconfirmed'}</small>
      </button>)}
      {props.showChannelConfiguration !== false && props.channels.some(c => c.sourceKind !== 'derived') && <button className="telemetry-configure" onClick={() => setConfiguring(v => !v)} aria-expanded={configuring}>Measurement channels</button>}
    </div>
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
