import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('Usage: node scripts/verify-desktop-csp.mjs <dist/index.html>');
  process.exit(1);
}

const html = readFileSync(htmlPath, 'utf8');
const csp = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i)?.[1]
  ?.replaceAll('&#39;', "'")
  ?.replaceAll('&quot;', '"');
if (!csp) throw new Error('Desktop index.html is missing a Content-Security-Policy meta tag.');

const scriptPolicy = csp.split(';').map((entry) => entry.trim())
  .find((entry) => entry.startsWith('script-src'));
if (scriptPolicy !== "script-src 'self'") {
  throw new Error(`Desktop script policy must be exactly script-src 'self'; received ${scriptPolicy || 'none'}.`);
}
if (!csp.includes("connect-src 'self'") || /https?:|wss?:/.test(csp)) {
  throw new Error('Desktop CSP must not permit remote HTTP or WebSocket connections.');
}

const themeScript = html.match(/<script\s+src="([^"]*theme-bootstrap\.js)"/i)?.[1];
if (!themeScript) throw new Error('Desktop index.html is missing the external theme bootstrap script.');
const themePath = resolve(dirname(htmlPath), themeScript.replace(/^\.\//, ''));
if (!existsSync(themePath)) throw new Error(`Theme bootstrap asset is missing: ${themePath}`);

console.log(`Verified packaged desktop CSP and ${themeScript}.`);
