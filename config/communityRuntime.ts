import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const communityModules = ['inventory-model', 'app', 'inventory-ui', 'people-model', 'people-ui', 'backend-client', 'connected-ui', 'telemetry-ui', 'domain-form', 'operations-ui', 'price-rules', 'community-charts', 'workspace-refinement'];
const exportsByFile: Record<string, string> = {'inventory-model':'InventoryModel','people-model':'PeopleModel','backend-client':'ConsoleBackend','domain-form':'DomainForm','price-rules':'PriceRules'};

/** Compile the existing workspace into a normal module, inside the React app.
 * No iframe, injected scripts, eval, second document or second authentication.
 * Keeping the existing modules preserves the tested domain forms during migration.
 */
export function communityRuntime(): Plugin {
  const id = 'virtual:community-runtime';
  return {
    name: 'community-workspace-module',
    resolveId(source) { if (source === id || source === 'virtual:community-styles') return '\0' + source; },
    load(source) {
      if (source === '\0virtual:community-styles') {
        const css = ['style','inventory-ui','people-ui'].map(name => {
          const file=resolve('public/console',name+'.css');this.addWatchFile(file);return readFileSync(file,'utf8');
        }).join('\n');
        return 'export default '+JSON.stringify(css);
      }
      if (source !== '\0' + id) return;
      const modules = communityModules.map(name => {
        const file = resolve('public/console', name + '.js');
        this.addWatchFile(file);
        const code = readFileSync(file, 'utf8')
          .replace(/^render\(\);$/gm, '')
          .replace('render();loadBackend().then(()=>refreshHistory()).catch(showConnectionError);', '')
          .replace(/src="assets\//g, 'src="/console/assets/');
        return `\n// ${name}\n${code}\n${exportsByFile[name] ? `const ${exportsByFile[name]}=globalThis.${exportsByFile[name]};` : ''}`;
      }).join('\n');
      return `export function mountWorkspace(environment, bridge) {
        const {document, window, fetch, setTimeout, clearTimeout, setInterval, clearInterval}=environment;
        const globalThis=window;
        ${modules}
        userMenu=()=>state.userOpen?'<div data-shared-user-menu></div>':'';
        const workspaceRender=render;
        render=function(){if(environment.disposed())return;workspaceRender();bridge.onRoute(workspacePath());};
        function workspacePath(){
          if(!state.loggedIn||connection.loading||connection.error)return null;
          if(person().role!=='manager')return '/app/community/'+(state.personalAsset?'equipment':state.operationsPage==='sessions'?'flexibility':({sites:'equipment',vehicles:'vehicles'}[state.personalPage]||'dashboard'));
          if(state.operationsPage)return '/app/community/'+(state.operationsPage==='sessions'?'flexibility':'contracts');
          return state.page==='communities'?'/communities':'/app/community/'+({overview:'dashboard',sites:'inventory',admin:'administration'}[state.page]||state.page);
        }
        function setPath(path){
          state.operationsPage=null;state.site=null;state.equipment=null;state.personalAsset=null;
          const part=path.split('/').filter(Boolean).at(-1);
          if(bridge.session.role==='prosumer'){
            state.personalPage=({equipment:'sites',vehicles:'vehicles'}[part]||'overview');
            if(part==='flexibility')state.operationsPage='sessions';
          }else{
            state.page=path==='/communities'?'communities':({dashboard:'overview',inventory:'sites',topology:'sites',administration:'admin'}[part]||'overview');
            if(part==='flexibility')state.operationsPage='sessions';
            if(part==='contracts'||part==='settings')state.page='settings';
            if(part==='insights')state.page='overview';
          }
          if(part==='topology')state.view='topology';
          render();
        }
        setPath(bridge.path);
        loadBackend().then(()=>refreshHistory()).catch(showConnectionError);
        return {setPath,closeAccount(){state.userOpen=false;render();}};
      }`;
    },
    handleHotUpdate(ctx) {
      if (communityModules.some(name => ctx.file.endsWith('/public/console/' + name + '.js'))) {
        const module=ctx.server.moduleGraph.getModuleById('\0'+id);
        if(module){ctx.server.moduleGraph.invalidateModule(module);ctx.server.ws.send({type:'full-reload'});return [];}
      }
    }
  };
}
