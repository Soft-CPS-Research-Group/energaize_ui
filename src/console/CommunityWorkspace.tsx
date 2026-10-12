import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useUI } from '../contexts/UIContext';
import { UserMenu } from '../components/layout/UserMenu';
import { EVChargingLoader } from '../components/ui/EVChargingLoader';
import { AUTH_SCENE_STORAGE_KEY } from '../constants';
import { MeasurementChart, type MeasurementChartProps } from './MeasurementChart';
import { MeasurementWorkspace, type MeasurementWorkspaceProps } from './MeasurementWorkspace';
import { createWorkspaceEnvironment } from './runtime-environment';
import { mountWorkspace } from 'virtual:community-runtime';
import baseCss from 'virtual:community-styles';
import calendarCss from 'react-day-picker/style.css?inline';
import telemetryCss from './telemetry.css?inline';
import { RuntimePanel } from './RuntimePanel';
import runtimeCss from './runtime.css?inline';
import presentationCss from './presentation.css?inline';
import loaderCss from '../components/ui/EVChargingLoader.css?inline';

const styles = [baseCss,calendarCss,telemetryCss,presentationCss,runtimeCss,loaderCss].join('\n')
  .replaceAll(':root', ':host').replace(/\bbody\b(?=[\s.{:#])/g, '.console-root');
type ChartProps = MeasurementChartProps & Partial<Pick<MeasurementWorkspaceProps,'channels'|'onLinkChannel'|'onUnlinkChannel'|'onConfigureChannel'>>;

/** Community is a route of the main React app. Shadow DOM only isolates the
 * existing workspace styles from Jobs while its views migrate to components. */
export function CommunityWorkspace(): JSX.Element {
  const {session,logout}=useAuth();
  const {theme}=useUI();
  const {pathname}=useLocation();
  const navigate=useNavigate();
  const navigation=useRef(navigate);navigation.current=navigate;
  const host=useRef<HTMLDivElement>(null);
  const runtime=useRef<ReturnType<typeof mountWorkspace>>();
  const activePath=useRef(pathname);
  const [accountSlot,setAccountSlot]=useState<HTMLElement|null>(null);
  const [loaderSlot,setLoaderSlot]=useState<HTMLElement|null>(null);
  useEffect(()=>{
    if(!host.current || !session)return;
    const shadow=host.current.shadowRoot||host.current.attachShadow({mode:'open'});
    const sheet=document.createElement('style');sheet.textContent=styles;
    const body=document.createElement('div');body.className='console-root';
    body.innerHTML='<div id="app"></div><div id="overlay"></div><div id="toast" role="status"></div>';
    shadow.replaceChildren(sheet,body);
    const roots=new Map<HTMLElement,Root>();
    const charts={mount(node:HTMLElement,props:ChartProps,key:string){
      let root=roots.get(node);if(!root){root=createRoot(node);roots.set(node,root);}
      root.render(props.channels?<MeasurementWorkspace key={key} {...props} channels={props.channels}/>:<MeasurementChart key={key} {...props}/>);
    }};
    const bridge={session,path:activePath.current,charts,
      logout:()=>{sessionStorage.setItem(AUTH_SCENE_STORAGE_KEY,'logout');logout();},
      navigate:(path:string)=>navigation.current(path),
      onRoute:(path:string|null)=>{if(path&&path!==activePath.current){activePath.current=path;navigation.current(path);}}
    };
    const environment=createWorkspaceEnvironment(shadow,body,bridge);
    const sync=()=>{
      roots.forEach((root,node)=>{if(!node.isConnected){root.unmount();roots.delete(node);}});
      shadow.querySelectorAll<HTMLElement>('[data-runtime-site], [data-runtime-admin]').forEach(node=>{
        if(roots.has(node))return;
        const root=createRoot(node);roots.set(node,root);
        root.render(<RuntimePanel siteId={node.dataset.runtimeSite} siteName={node.dataset.runtimeName} kind={node.dataset.runtimeKind as 'percepta'|'controller'|undefined} navigate={path=>navigation.current(path)}/>);
      });
      setAccountSlot(shadow.querySelector<HTMLElement>('[data-shared-user-menu]'));
      setLoaderSlot(shadow.querySelector<HTMLElement>('[data-console-loader]'));
    };
    const observer=new MutationObserver(sync);observer.observe(body,{childList:true,subtree:true});
    runtime.current=mountWorkspace(environment,bridge);sync();
    return ()=>{environment.dispose();observer.disconnect();runtime.current=undefined;const retired=[...roots.values()];queueMicrotask(()=>retired.forEach(root=>root.unmount()));};
  },[session?.email,session?.role,logout]);
  useEffect(()=>{if(pathname!==activePath.current){activePath.current=pathname;runtime.current?.setPath(pathname);}},[pathname]);
  return <>
    <div ref={host} data-community-workspace data-theme={theme} />
    {accountSlot&&createPortal(<UserMenu open onClose={()=>runtime.current?.closeAccount()}/>,accountSlot)}
    {loaderSlot&&createPortal(<EVChargingLoader label="Loading your community, equipment and permissions…"/>,loaderSlot)}
  </>;
}
