const fs = require('fs');

let file = fs.readFileSync('src/pages/PredictorWorkspacePage.tsx', 'utf8');

file = file.replace(
  'import { useState, useEffect } from "react";',
  'import { useState, useEffect } from "react";\\nimport { Route, Routes, useLocation, Navigate } from "react-router-dom";'
);

file = file.replace(
  'const [activeTab, setActiveTab] = useState<Tab>("predict");\\n',
  'const location = useLocation();\\n  const isLogsTab = location.pathname.endsWith("/logs");\\n'
);

file = file.replace(
  'type Tab = "predict" | "train" | "logs";\\n\\n',
  ''
);

file = file.replace(
  'disabled={activeTab === "logs"} // Logs are global, hide context change',
  'disabled={isLogsTab} // Logs are global, hide context change'
);

file = file.replace(
\      <div className="flex gap-2">
         <Button 
            variant={activeTab === "predict" ? "primary" : "ghost"}
            onClick={() => setActiveTab("predict")}
         >
            <Activity className="mr-2" size={16} /> Predict
         </Button>
         <Button 
            variant={activeTab === "train" ? "primary" : "ghost"}
            onClick={() => setActiveTab("train")}
         >
            <Database className="mr-2" size={16} /> Train
         </Button>
         <Button 
            variant={activeTab === "logs" ? "primary" : "ghost"}
            onClick={() => setActiveTab("logs")}
         >
            <Terminal className="mr-2" size={16} /> Logs
         </Button>
      </div>\,
''
);

file = file.replace(
\      <div className="flex-1 overflow-y-auto w-full pt-2">
         {activeTab === "predict" && <PredictView selectedHouseId={selectedHouse} />}
         {activeTab === "train" && <TrainView selectedHouseId={selectedHouse} />}
         {activeTab === "logs" && <LogsView />}
      </div>\,
\      <div className="flex-1 overflow-y-auto w-full pt-2">
         <Routes>
           <Route path="/" element={<PredictView selectedHouseId={selectedHouse} />} />
           <Route path="/train" element={<TrainView selectedHouseId={selectedHouse} />} />
           <Route path="/logs" element={<LogsView />} />
           <Route path="*" element={<Navigate to="/app/predictor" replace />} />
         </Routes>
      </div>\
);

fs.writeFileSync('src/pages/PredictorWorkspacePage.tsx', file);
