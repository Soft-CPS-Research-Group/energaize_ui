import {useEffect, useState} from 'react';
import {Cpu} from 'lucide-react';
import {runtimeRequest} from '../api/runtimeApi';

interface MachineAssociation {
  site_id: string;
  local_machine: {
    name: string;
    hardware_model: string | null;
    memory_gb: number | null;
    runtime_host_id: string | null;
  } | null;
}

/** The saved association is inventory, not proof of connectivity or a running service. */
export function SiteMachine({siteId}: {siteId: string}) {
  const [result, setResult] = useState<MachineAssociation | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setResult(null); setError(false);
    void runtimeRequest<MachineAssociation>(`/api/runtime/sites/${encodeURIComponent(siteId)}/deployment`)
      .then(value => {
        if (value.site_id !== siteId) throw Error('Unexpected house association');
        if (current) setResult(value);
      })
      .catch(() => {if (current) setError(true);});
    return () => {current = false;};
  }, [siteId, attempt]);
  // Do not show the previous house while the new request is being loaded.
  const association = result?.site_id === siteId ? result : null;
  const machine = association?.local_machine;
  return <section className="site-machine surface" aria-label="Associated local machine">
    <div className="sectionhead"><h2><Cpu size={19} aria-hidden="true"/> Local machine</h2></div>
    {error ? <div role="alert">Unable to load this house’s machine association. <button className="btn text" onClick={() => setAttempt(n => n + 1)}>Retry</button></div>
      : !association ? <p role="status">Loading machine association…</p>
      : !machine ? <><p><strong>No local machine associated</strong></p><p className="footnote">This house has no local equipment assigned to run energAIze services.</p></>
      : <><dl className="definition-list">
        <div><dt>Machine</dt><dd>{machine.name}</dd></div>
        <div><dt>Hardware</dt><dd>{machine.hardware_model || 'Not specified'}</dd></div>
        {machine.memory_gb != null && <div><dt>Memory</dt><dd>{machine.memory_gb} GB</dd></div>}
        <div><dt>Registration</dt><dd>{machine.runtime_host_id ? 'Deployment destination registered' : 'Connection setup pending'}</dd></div>
      </dl><p className="footnote">Saved association. Connection and running services are not verified here.</p></>}
  </section>;
}
