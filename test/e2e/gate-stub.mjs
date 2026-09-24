// The gateway in front of Cezar, as an unauthenticated browser sees it: every
// request is refused with nginx's bare 403 page (`docs/CEZAR_API.md` § 1a).
//
// The E2E preview proxies /api here (playwright.config.ts). Most specs stub
// the API with `page.route`, but Playwright's WebKit does not route requests
// from a page the service worker controls, so those reach the proxy. They must
// meet a gate, not a refused connection — and never a live instance.
//
//   node test/e2e/gate-stub.mjs <port>
import { createServer } from 'node:http'

const port = Number(process.argv[2])
if (!Number.isInteger(port) || port <= 0) {
  console.error('usage: node test/e2e/gate-stub.mjs <port>')
  process.exit(2)
}

createServer((_, res) => {
  res.writeHead(403, { 'content-type': 'text/html' })
  res.end('<html><head><title>403 Forbidden</title></head><body>403</body></html>')
}).listen(port, '127.0.0.1')
