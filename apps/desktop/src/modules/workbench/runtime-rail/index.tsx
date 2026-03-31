import type { RuntimeRailProps } from "./types";

export const RuntimeRail = ({ terminalLogs, metrics }: RuntimeRailProps) => (
  <footer className="lyra-runtime-rail" aria-label="runtime-rail">
    <div className="lyra-terminal-output">
      {terminalLogs.map((line, index) => (
        <div key={`${line}-${index}`}>{line}</div>
      ))}
    </div>
    <aside className="lyra-runtime-metrics">
      {metrics.map((metric) => (
        <div key={metric.id} className="lyra-metric-row">
          <span>{metric.label}</span>
          <div className="lyra-metric-bar">
            <span style={{ width: `${metric.percent}%` }} />
          </div>
          <span>{metric.valueText}</span>
        </div>
      ))}
    </aside>
  </footer>
);
