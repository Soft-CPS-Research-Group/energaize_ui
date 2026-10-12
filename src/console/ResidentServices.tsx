import { useEffect, useState } from 'react';
import { Cpu, Radio } from 'lucide-react';
import { runtimeRequest, type RuntimeInstance } from '../api/runtimeApi';

/** A read-only association summary, not a claim of live control or data collection. */
export function ResidentServices({siteId}: {siteId: string}) {
  const [items, setItems] = useState<RuntimeInstance[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setItems(null);setFailed(false);
    runtimeRequest<RuntimeInstance[]>('/api/runtime/instances?site_id='+encodeURIComponent(siteId), {signal:abort.signal})
      .then(result => {if(!abort.signal.aborted)setItems(result.filter(item => item.site_ids.includes(siteId) && item.observed_state !== 'retired'));})
      .catch(() => {if(!abort.signal.aborted)setFailed(true);});
    return () => abort.abort();
  }, [siteId]);
  return <section className="resident-services" aria-label="Home services">
    {(['controller', 'percepta'] as const).map(kind => {
      const assigned = items?.filter(item => item.kind === kind);
      const Icon = kind === 'controller' ? Cpu : Radio;
      return <div className="resident-service" key={kind}>
        <span className="resident-service-icon"><Icon size={22}/></span>
        <div><h2>{kind === 'controller' ? 'Energy algorithm' : 'Percepta'}</h2>
          <p>{failed ? 'Service information is unavailable.' : !items ? 'Checking your home’s services…' : !assigned?.length ? 'No service assigned to this home.' : assigned.map(item => item.name).join(' · ')}</p>
          {!!assigned?.length && <small>Assigned to your home{assigned.every(item => item.mode === 'simulation') ? ' · Simulation' : ''}</small>}
        </div>
      </div>;
    })}
  </section>;
}
