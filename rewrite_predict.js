const fs = require('fs');
let file = fs.readFileSync('src/pages/ai/predictor/PredictView.tsx', 'utf8');

file = file.replace(
  '<div className="space-y-6">',
  '<div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>'
);

file = file.replace(
  '<div className="grid grid-cols-4 gap-4">',
  '<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>'
);

file = file.replace(
  '<div className="panel flex flex-col items-stretch space-y-4">',
  '<div className="panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>'
);

file = file.replace(
  '<div className="flex items-center justify-between">',
  '<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>'
);

file = file.replace(
  '<h3 className="text-lg font-semibold m-0">',
  '<h3 style={{ margin: 0 }}>'
);

file = file.replace(
  '<div className="flex gap-2">',
  '<div style={{ display: "flex", gap: "8px" }}>'
);

file = file.replace(
  '<div className="w-full relative -ml-4" style={{ height: 400, minHeight: 400, minWidth: 0 }}>',
  '<div style={{ width: "100%", height: 400, minHeight: 400, minWidth: 0, position: "relative", marginLeft: "-16px" }}>'
);

file = file.replace(
  '<div className="panel p-4 flex flex-col justify-center items-center h-28">',
  '<div className="panel" style={{ padding: "16px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "112px" }}>'
);

file = file.replace(
  '<div className="text-sm opacity-70 mb-1">{title}</div>',
  '<div style={{ fontSize: "0.875rem", opacity: 0.7, marginBottom: "4px" }}>{title}</div>'
);

file = file.replace(
  '<div className="text-3xl font-bold text-brand">{value}</div>',
  '<div style={{ fontSize: "1.875rem", fontWeight: "bold", color: "var(--brand)" }}>{value}</div>'
);

fs.writeFileSync('src/pages/ai/predictor/PredictView.tsx', file);
