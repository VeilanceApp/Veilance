// Self-contained so Chrome can run this function in the visited page.
export function discoverPolicyLinks() {
  const candidates = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const label = (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ');
    let url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
    let path;try{path=decodeURI(url.pathname).toLowerCase();}catch{continue;}
    if (/\/(status|statuses|posts?|share|intent)\//i.test(path)) continue;
    const policyPath = /(?:^|[/_.-])(?:privacy|data[-_]protection|data[-_]policy)(?:$|[/_.-])/i.test(path);
    const policyLabel = label.length <= 100 && /^(?:view |read |our |the )?(?:privacy(?: policy| notice| statement)?|data protection(?: policy| notice)?|data policy)(?:\s*[↗→»])?$/i.test(label);
    if (!policyPath && !policyLabel) continue;
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) continue;
    if (!policyPath && /(?:^|\.)(?:x\.com|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com)$/.test(url.hostname)) continue;
    url.hash = '';
    const score = (policyPath ? 3 : 0) + (policyLabel ? 2 : 0) + (url.origin === location.origin ? 2 : 0);
    candidates.set(url.href, Math.max(score, candidates.get(url.href) || 0));
  }
  return [...candidates].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([url])=>url);
}
