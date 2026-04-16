const fs = require('fs');
let file = fs.readFileSync('src/pages/ai/predictor/LogsView.tsx', 'utf8');

file = file.replace(
  '<div className="flex flex-col h-[calc(100vh-200px)] panel p-0 overflow-hidden">',
  '<div className="panel" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 200px)", padding: 0, overflow: "hidden" }}>'
);
file = file.replace(
  '<div className="flex items-center justify-between p-4 border-b border-border bg-subtle shrink-0">',
  '<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)", flexShrink: 0 }}>'
);
file = file.replace(
  '<div className="flex gap-2">',
  '<div style={{ display: "flex", gap: "8px" }}>'
);
file = file.replace(
  '<div className="flex items-center gap-4">',
  '<div style={{ display: "flex", alignItems: "center", gap: "16px" }}>'
);
file = file.replace(
  '<h2 className="text-lg font-semibold m-0">Live Application Logs</h2>',
  '<h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Live Application Logs</h2>'
);

fs.writeFileSync('src/pages/ai/predictor/LogsView.tsx', file);
