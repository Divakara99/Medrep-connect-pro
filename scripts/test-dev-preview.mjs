// The service worker must never run against the dev preview.
//
// sw.js answers asset requests cache-first. Against Vite that means a browser
// keeps an old module graph — including an old copy of React — while the HTML
// comes fresh from the network. The result is a blank page or the classic
// "Cannot read properties of null (reading 'useRef')" crash, and it survives
// server restarts because the cache lives in the browser.
//
// Production keeps the worker (offline shell, push notifications); Android never
// registers it. This test holds that line.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

const main = await read('../src/main.tsx')
const sw = await read('../public/sw.js')

// ---------- dev: no worker, and any old one is removed ----------
const mainFlat = main.replace(/\s+/g, ' ')

assert.match(main, /const devPreview = import\.meta\.env\.DEV/, 'dev mode is detected at build time')
assert.ok(
  /if \(devPreview\) \{/.test(mainFlat),
  'dev mode has its own branch',
)
assert.ok(
  mainFlat.includes('serviceWorker .getRegistrations() .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))'),
  'a worker left by an earlier session is unregistered in dev',
)
assert.ok(mainFlat.includes("'caches' in window"), 'the cache API is checked before use')
assert.ok(mainFlat.includes("caches .keys() .then((keys) => Promise.all(keys.filter((key) => key.startsWith('mrc-')).map((key) => caches.delete(key))))"), 'this app\'s caches are deleted in dev')
assert.ok(mainFlat.includes('if (!wasControlled || alreadyReset) return'), 'the one-time reload is skipped when it would loop')

// ---------- production: registration still happens, on load ----------
const elseBranch = main.slice(main.indexOf('} else {', main.indexOf('devPreview')))
assert.match(elseBranch, /addEventListener\('load'/, 'production still registers on load')
assert.match(elseBranch, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/, 'the deployed site keeps its worker')

// The registration must be the only one, and it must not sit outside the
// production branch.
assert.equal((main.match(/serviceWorker\.register\(/g) || []).length, 1, 'exactly one registration site')

// ---------- Android never registers it ----------
assert.match(main, /!isNativeApp\(\) && 'serviceWorker' in navigator/, 'the Android app is excluded')

// ---------- cache name bumped with the shell ----------
assert.match(sw, /const CACHE = 'mrc-v\d+'/, 'the cache has a versioned name')
assert.ok(!/const CACHE = 'mrc-v8'/.test(sw), 'the shell change bumped the cache name past v8')

console.log('dev preview: no service worker against Vite, production keeps it, Android excluded — passed')
