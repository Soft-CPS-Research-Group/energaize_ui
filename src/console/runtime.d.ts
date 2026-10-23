declare module 'virtual:community-runtime' {
  export function mountWorkspace(environment: ReturnType<typeof import('./runtime-environment').createWorkspaceEnvironment>, bridge: import('./runtime-environment').WorkspaceBridge): {setPath:(path:string)=>void;closeAccount:()=>void;activityScope:()=>import('./ActivityPanel').ActivityScope};
}
declare module 'virtual:community-styles' { const css:string; export default css; }
