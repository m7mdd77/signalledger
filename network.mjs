import https from 'node:https';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export function publicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === 'unicast';
  } catch { return false; }
}

export function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Only credential-free HTTPS on port 443 is allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || (ipaddr.isValid(host) && !publicAddress(host))) throw new Error('Non-public destination');
  return url;
}

// Resolve once, reject any private answer, and pin the socket to the validated answer.
export async function request(value, {limit = 2_000_000, redirects = 3, timeout = 12_000} = {}) {
  const url = safeUrl(value);
  const answers = await dns.lookup(url.hostname, {all: true});
  if (!answers.length || answers.some(a => !publicAddress(a.address))) throw new Error('DNS destination is not entirely public');
  const response = await new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {'user-agent': 'SignalLedger/1.0 (public company research; no login)', accept: 'application/json,text/html,text/plain;q=0.9', 'accept-encoding': 'identity'},
      lookup: (_host, options, cb) => options.all ? cb(null, answers) : cb(null, answers[0].address, answers[0].family)
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > limit) req.destroy(new Error('Response exceeded byte limit')); else chunks.push(chunk); });
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), url: url.href}));
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('Request deadline exceeded')), timeout);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
  });
  if ([301,302,303,307,308].includes(response.status)) {
    if (!redirects || !response.headers.location) throw new Error('Redirect budget exhausted');
    return request(new URL(response.headers.location, url).href, {limit, timeout, redirects: redirects - 1});
  }
  return response;
}
