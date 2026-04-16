const fs = require('fs');
let file = fs.readFileSync('src/pages/ai/predictor/TrainView.tsx', 'utf8');

file = file.replace(
  '<div className="space-y-6">',
  '<div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>'
);

file = file.replace(
  '<div className="flex gap-4 mb-4">',
  '<div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>'
);

file = file.replace(
  '<div className="p-4 border-b border-border bg-subtle">',
  '<div style={{ padding: "16px", borderBottom: "1px border-border", backgroundColor: "var(--bg-subtle)" }}>'
);

file = file.replace(
  '<h2 className="text-lg font-semibold">Active Training Jobs</h2>',
  '<h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Active Training Jobs</h2>'
);

file = file.replace(
  '<table className="w-full text-left border-collapse">',
  '<table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>'
);

file = file.replace(
  '<table className="w-full text-left border-collapse">',
  '<table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>'
);

fs.writeFileSync('src/pages/ai/predictor/TrainView.tsx', file);
