# SKAI V0.5 CEO Interface Preview

This is an interactive **static UI preview only**, in the development branch. It does not request credentials, call OpenAI, or modify SKAI company data.

## Interface
- Apple-inspired neutral white/gray interface, soft blur, light gradients.
- Isometric office illustration with nine individually selectable AI leadership characters.
- Employee detail dialog and CEO dashboard sections.
- iPhone 15 Pro Max portrait- and landscape-specific layouts, safe-area spacing, readable labels and bottom tabs.
- Honest offline status and blank KPI values (no fake performance or progress claims).

## Preview locally
Serve the `frontend` directory with any local static HTTP server. Example: `python3 -m http.server 8080 --directory frontend`, then visit `http://localhost:8080`. Opening `index.html` directly may block JS module imports on some browsers.

## Pending before connecting real data
- Authenticated first-party sessions, server-side secrets, anti-CSRF strategy, API throttling, and protected API gateway.
- Backend staging deployment with PostgreSQL, OpenAI API and validated policies.
- Real work queues and approved executive actions.
- Actual phone browser tests (iPhone 15 Pro Max Safari) and landscape usability verification.

Do **not** place `SKAI_ADMIN_TOKEN` or OpenAI keys into any frontend file, client-side storage or public GitHub Pages build.

## Same-origin integration
The development backend now serves this UI from `/` and connects browser actions through first-party session cookies, never a client-side API key. The interface reads real database records only when the test environment has been deployed and the CEO is authenticated; otherwise it keeps blank status indicators.
