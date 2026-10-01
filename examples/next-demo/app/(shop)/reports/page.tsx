"use client";

import { useState } from "react";

interface Report {
  rows: { month: string; orders: number }[];
}

function ReportTable({ report }: { report?: Report }) {
  // Bug on purpose: the report never arrives, and rendering reads it anyway.
  // The error boundary (error.tsx) catches it and reports it to chronos.
  return (
    <table className="report">
      <tbody>
        {(report as Report).rows.map((row) => (
          <tr key={row.month}>
            <td>{row.month}</td>
            <td>{row.orders}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReportsPage() {
  const [show, setShow] = useState(false);
  const [month, setMonth] = useState("2026-09");
  return (
    <div className="panel narrow">
      <h1>Reports</h1>
      <p className="muted">Monthly order counts.</p>
      <label>
        Month
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      <button type="button" className="primary" onClick={() => setShow(true)}>
        Load report
      </button>
      {show && <ReportTable />}
    </div>
  );
}
