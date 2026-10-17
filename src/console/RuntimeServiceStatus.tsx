import type { RuntimeInstance } from '../api/runtimeApi';
export function configurationState(item: RuntimeInstance): string {
  if (item.configuration_error) return 'Review required';
  if (!item.desired_config_version) return 'Not prepared';
  if (!item.applied_config_version) return 'Awaiting confirmation';
  return item.desired_config_version === item.applied_config_version ? 'Up to date' : 'Changes pending';
}
export function serviceState(item: RuntimeInstance): string {
  if (item.mode === 'simulation') return 'Simulation';
  if (item.error || item.health === 'unhealthy') return 'Needs attention';
  return ({ running: 'Service started', exited: 'Stopped', created: 'Ready to start', missing: 'Not found', not_deployed: 'Not started', retired: 'Retired' } as Record<string,string>)[item.observed_state] || 'State unconfirmed';
}
export function RuntimeServiceStatus({item}: {item: RuntimeInstance}) {
  return <div className="runtime-configuration-state">
    <div><small>Configuration</small><strong>{configurationState(item)}</strong></div>
    <div><small>Last service check</small><strong>{item.last_checked_at ? new Date(item.last_checked_at).toLocaleString('en-GB') : 'Not checked'}</strong></div>
    <div><small>{item.kind === 'percepta' ? 'Data collection' : 'Equipment control'}</small><strong>{item.mode === 'simulation' ? 'Simulated only' : item.configuration_mode === 'generated' && item.kind === 'percepta' ? 'Status below' : 'Not confirmed'}</strong><small>{item.kind === 'percepta' ? 'Fresh readings are checked separately' : 'Command execution is not reported yet'}</small></div>
  </div>;
}
