// Compatibility shim.
//
// The worker is worker.ts now, so it can share the app's own TypeScript
// modules instead of reimplementing the GE maths. This file exists so that
// `node worker.js` keeps working — docker-compose lives on the server rather
// than in this repo, and a deploy should not break just because its command
// still names the old entrypoint.
//
// Registers tsx's require hook (which also resolves the "@/" path alias from
// tsconfig.json) and hands over.
require('tsx/cjs');
require('./worker.ts');
