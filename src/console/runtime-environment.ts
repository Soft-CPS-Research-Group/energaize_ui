import { expandFlexEvents } from './flexRecurrence';
import type { Session } from '../types';
export interface WorkspaceBridge {
  session: Session;
  path: string;
  logout: () => void;
  navigate: (path: string) => void;
  onRoute: (path: string | null) => void;
  charts: unknown;
}

/** Own every listener, timer and request for this mounted workspace. */
export function createWorkspaceEnvironment(root: ShadowRoot, body: HTMLElement, bridge: WorkspaceBridge) {
  let disposed = false;
  const abort = new AbortController();
  const listeners: Array<() => void> = [];
  const timeouts = new Set<number>();
  const intervals = new Set<number>();
  const add = (target: EventTarget) => (name: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    target.addEventListener(name, listener, options);
    listeners.push(() => target.removeEventListener(name, listener, options));
  };
  const scopedDocument = new Proxy(document, {
    get(target, key) {
      if (key === 'body') return body;
      if (key === 'activeElement') return root.activeElement;
      if (key === 'addEventListener') return add(root);
      if (['getElementById','querySelector','querySelectorAll'].includes(String(key))) return (root[key as keyof ShadowRoot] as Function).bind(root);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return {
    document: scopedDocument,
    window: { FlexRecurrence: {expand:expandFlexEvents}, AppBridge: bridge, TelemetryCharts: bridge.charts, workbookInventory: {entities:[]}, connectedConsole:true, addEventListener:add(window) },
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {...init, signal: init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal}),
    setTimeout: (callback: () => void, delay?: number) => { const id=window.setTimeout(()=>{timeouts.delete(id);if(!disposed)callback();}, delay);timeouts.add(id);return id; },
    clearTimeout: (id: number) => {window.clearTimeout(id);timeouts.delete(id);},
    setInterval: (callback: () => void, delay?: number) => {const id=window.setInterval(()=>{if(!disposed)callback();},delay);intervals.add(id);return id;},
    clearInterval: (id: number) => {window.clearInterval(id);intervals.delete(id);},
    disposed: () => disposed,
    dispose() { disposed=true;abort.abort();listeners.forEach(remove=>remove());timeouts.forEach(id=>window.clearTimeout(id));intervals.forEach(id=>window.clearInterval(id)); }
  };
}
