/**
 * CSS stylesheet for the BoardReadyOps HTML report.
 */
export const reportCss = `:root {
      color-scheme: light dark;
      --background: #f8fafc;
      --surface: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --border: #e2e8f0;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;

      --critical: #dc2626;
      --critical-bg: #fef2f2;
      --high: #d97706;
      --high-bg: #fffbeb;
      --medium: #ca8a04;
      --medium-bg: #fef9c3;
      --low: #0d9488;
      --low-bg: #f0fdfa;
      --info: #2563eb;
      --info-bg: #eff6ff;

      --pass: #16a34a;
      --pass-bg: #f0fdf4;

      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
      --shadow-md: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
      --transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --background: #0f172a;
        --surface: #1e293b;
        --text: #f8fafc;
        --muted: #94a3b8;
        --border: #334155;
        --accent: #3b82f6;
        --accent-hover: #60a5fa;

        --critical-bg: rgba(220, 38, 38, 0.1);
        --high-bg: rgba(217, 119, 6, 0.1);
        --medium-bg: rgba(202, 138, 4, 0.1);
        --low-bg: rgba(13, 148, 136, 0.1);
        --info-bg: rgba(37, 99, 235, 0.1);
        --pass-bg: rgba(22, 163, 74, 0.1);
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--background);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    a {
      color: var(--accent);
      text-decoration: none;
      transition: var(--transition);
    }

    a:hover {
      color: var(--accent-hover);
      text-decoration: underline;
    }

    header,
    main {
      width: min(1200px, calc(100% - 32px));
      margin: 0 auto;
    }

    header {
      padding: 40px 0 24px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 32px;
    }

    h1, h2, h3 {
      margin: 0;
      font-weight: 800;
      letter-spacing: -0.025em;
      color: var(--text);
    }

    h1 {
      font-size: 2.5rem;
      background: linear-gradient(135deg, var(--text) 60%, var(--accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    h2 {
      margin: 40px 0 16px;
      font-size: 1.5rem;
      border-bottom: 2px solid var(--border);
      padding-bottom: 8px;
    }

    h3 {
      margin: 20px 0 10px;
      font-size: 1.1rem;
    }

    .metadata {
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 0.95rem;
    }

    .summary-grid,
    .breakdown-grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      margin-bottom: 24px;
    }

    .metric,
    .panel {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      padding: 20px;
      box-shadow: var(--shadow-sm);
      transition: var(--transition);
    }

    .metric:hover,
    .panel:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow);
    }

    .metric strong {
      display: block;
      font-size: 2.25rem;
      font-weight: 800;
      line-height: 1;
      margin-bottom: 4px;
    }

    .metric span,
    .empty,
    .muted {
      color: var(--muted);
      font-size: 0.9rem;
    }

    .filter-bar {
      position: sticky;
      top: 16px;
      z-index: 100;
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      align-items: end;
      margin: 32px 0 24px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 16px;
      box-shadow: var(--shadow-md);
      transition: var(--transition);
    }

    @supports (backdrop-filter: blur(12px)) {
      .filter-bar {
        background: rgba(255, 255, 255, 0.8);
      }
      @media (prefers-color-scheme: dark) {
        .filter-bar {
          background: rgba(30, 41, 59, 0.8);
        }
      }
    }

    label {
      display: grid;
      gap: 6px;
      font-weight: 600;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }

    select {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      padding: 10px 14px;
      font-size: 0.95rem;
      transition: var(--transition);
      cursor: pointer;
      outline: none;
    }

    select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }

    .count {
      align-self: center;
      color: var(--muted);
      font-weight: 700;
      font-size: 1rem;
      background: var(--background);
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
      text-align: center;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
      margin-bottom: 32px;
    }

    caption {
      padding: 12px 4px;
      text-align: left;
      font-weight: 800;
      font-size: 1.1rem;
      color: var(--text);
    }

    th,
    td {
      padding: 14px 16px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--border);
    }

    tr:last-child td {
      border-bottom: 0;
    }

    thead th {
      background: var(--background);
      font-weight: 700;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      border-bottom: 2px solid var(--border);
    }

    code {
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.875em;
      background: var(--background);
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 80px;
      border-radius: 9999px;
      padding: 4px 12px;
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      text-align: center;
    }

    .severity-critical { background: var(--critical); }
    .severity-high { background: var(--high); }
    .severity-medium { background: var(--medium); }
    .severity-low { background: var(--low); }
    .severity-info { background: var(--info); }

    .readiness-ready { background: var(--pass); }
    .readiness-at-risk { background: var(--high); }
    .readiness-blocked { background: var(--critical); }

    .diff-added { background: var(--pass); }
    .diff-removed { background: var(--critical); }
    .diff-changed { background: var(--high); }
    .diff-unchanged { background: var(--muted); }

    .diff-findings {
      list-style: none;
      padding: 0;
      display: grid;
      gap: 8px;
    }

    .diff-findings li {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .readiness-score {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      font-size: 1.15rem;
      font-weight: 600;
    }

    .decision {
      border: 1px solid var(--border);
      border-left-width: 8px;
      border-radius: 14px;
      padding: 20px 24px;
      background: var(--surface);
      box-shadow: var(--shadow);
      margin-bottom: 24px;
      transition: var(--transition);
    }

    .decision-pass {
      border-left-color: var(--pass);
      background: linear-gradient(to right, var(--pass-bg), var(--surface) 30%);
    }

    .decision-fail {
      border-left-color: var(--critical);
      background: linear-gradient(to right, var(--critical-bg), var(--surface) 30%);
    }

    .decision-badge-pass { background: var(--pass); }
    .decision-badge-fail { background: var(--critical); }

    .decision-status {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    details {
      margin-top: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--background);
      transition: var(--transition);
    }

    summary {
      cursor: pointer;
      font-weight: 700;
      padding: 12px 16px;
      background: var(--surface);
      user-select: none;
      transition: var(--transition);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    summary:hover {
      background: var(--background);
    }

    .detail-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      padding: 16px;
    }

    .detail-item {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
    }

    ol, ul {
      margin: 8px 0 0;
      padding-left: 24px;
    }

    pre {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--background);
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.875rem;
    }

    @media (max-width: 768px) {
      header,
      main {
        width: min(100% - 24px, 1200px);
      }

      table, thead, tbody, th, td, tr {
        display: block;
      }

      thead {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      tr {
        border-top: 1px solid var(--border);
        border-radius: 8px;
        margin-bottom: 16px;
        overflow: hidden;
        box-shadow: var(--shadow-sm);
      }

      td {
        border-top: 0;
        border-bottom: 1px solid var(--border);
      }

      td:last-child {
        border-bottom: 0;
      }

      td::before {
        display: block;
        color: var(--muted);
        content: attr(data-label);
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 4px;
      }
    }

    @media print {
      body {
        background: #ffffff;
        color: #000000;
      }

      .filter-bar {
        position: static;
        box-shadow: none;
        background: #ffffff;
      }

      select, script {
        display: none;
      }

      a {
        color: #000000;
        text-decoration: underline;
      }
    }
  `;
