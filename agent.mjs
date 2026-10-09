import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import robotsParser from 'robots-parser';
import {request, safeUrl} from './network.mjs';

export const STATES = ['available','not_available','blocked','not_applicable','ambiguous','failed'];
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function orgNumber(value) {
  const n = String(value).replace(/\s/g, '');
  if (!/^\d{9}$/.test(n)) throw new Error('Organisation number must have nine digits');
  const sum = [3,2,7,6,5,4,3,2].reduce((s,w,i) => s+w*Number(n[i]),0);
  const check = (11 - sum % 11) % 11;
  if (check === 10 || check !== Number(n[8])) throw new Error('Organisation number checksum mismatch');
  return n;
}
export function changes(previous = [], current = [], successfulFamilies = []) {
  const key = c => canonical([c.field,c.value,c.reporting_period ?? null,c.scope ?? 'entity']);
  const old = new Map(previous.map(c => [key(c),c])); const next = new Map(current.map(c => [key(c),c]));
  return {
    added: [...next].filter(([k]) => !old.has(k)).map(([,c]) => c),
    removed: [...old].filter(([k,c]) => !next.has(k) && successfulFamilies.includes(c.family)).map(([,c]) => c),
    unavailable_comparison: [...new Set(previous.map(c => c.family))].filter(f => !successfulFamilies.includes(f))
  };
}
export function factsFromRegistry(data, org) {
  if (String(data.organisasjonsnummer) !== org) throw new Error('Registry entity mismatch');
  const result = [];
  const add = (field,value,period) => { if (value !== undefined && value !== null && value !== '') result.push({field,value,family:'identity',reporting_period:period ?? null,scope:'entity'}); };
  add('legal_name',data.navn); add('legal_form',data.organisasjonsform?.beskrivelse);
  add('registered_address',data.forretningsadresse); add('industry',data.naeringskode1);
  add('incorporated',data.stiftelsesdato); add('registered',data.registreringsdatoEnhetsregisteret);
  if (data.harRegistrertAntallAnsatte) add('registered_employees',data.antallAnsatte,data.registreringsdatoAntallAnsatteEnhetsregisteret);
  add('activity',data.aktivitet); add('latest_filed_year',data.sisteInnsendteAarsregnskap);
  add('bankrupt',data.konkurs); add('winding_up',data.underAvvikling);
  if (data.hjemmeside) add('registry_website_candidate',data.hjemmeside);
  return result;
}
export function financialClaims(rows, org) {
  if (!Array.isArray(rows)) throw new Error('Accounts response is not an array');
  const fields = {
    revenue: ['resultatregnskapResultat','driftsresultat','driftsinntekter','sumDriftsinntekter'],
    operating_profit: ['resultatregnskapResultat','driftsresultat','driftsresultat'],
    net_profit: ['resultatregnskapResultat','aarsresultat'],
    assets: ['eiendeler','sumEiendeler'], equity: ['egenkapitalGjeld','egenkapital','sumEgenkapital']
  };
  const claims = [];
  for (const row of rows) {
    if (String(row.virksomhet?.organisasjonsnummer) !== org) throw new Error('Accounts entity mismatch');
    if (!row.regnskapsperiode?.tilDato || !row.valuta || !['SELSKAP','KONSERN'].includes(row.regnskapstype)) continue;
    for (const [field,path] of Object.entries(fields)) {
      const value = path.reduce((v,k) => v?.[k],row);
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      claims.push({field,value:{amount:value,currency:row.valuta},family:'accounts',reporting_period:row.regnskapsperiode,scope:row.regnskapstype === 'KONSERN' ? 'group' : 'entity',extractor:'json-path',source_path:`id=${row.id};${path.join('.')}`});
    }
  }
  return [...new Map(claims.map(c=>[canonical([c.field,c.value,c.reporting_period,c.scope]),c])).values()];
}
export function redactRoles(data) {
  return {rollegrupper:(data.rollegrupper ?? []).map(g=>({type:g.type?.beskrivelse,sistEndret:g.sistEndret,roller:(g.roller ?? []).filter(r=>!r.avregistrert).map(r=>({role:r.type?.beskrivelse,name:r.person?.navn ?? null,organisation:r.enhet?.organisasjonsnummer ?? null}))}))};
}
export function websiteFacts(html, org, url) {
  const $ = load(html); $('script,style,noscript').remove();
  const text = $('body').text().replace(/\s+/g,' ').trim();
  // A registered candidate domain is not proof that a parent/group site represents this entity.
  const digits = org.split('').join('[\\s.\\-]*');
  const match = text.match(new RegExp('(?:^|[^0-9])('+digits+')(?:[^0-9]|$)'));
  if (!match) return {state:'ambiguous',claims:[],reason:'No exact organisation number on checked page'};
  const proof = text.slice(Math.max(0,match.index-55),match.index+match[0].length+55);
  const title = $('title').text().trim().slice(0,180);
  const claims = [{field:'verified_website',value:url,family:'website',scope:'entity',evidence_span:proof,extractor:'exact-org-number'}];
  if (title) claims.push({field:'website_title',value:title,family:'website',scope:'entity',evidence_span:title,extractor:'html-title'});
  const links = [];
  $('a[href]').each((_i,a)=>{
    const label = $(a).text().replace(/\s+/g,' ').trim();
    if (!label || label.length>120) return;
    try { const target=safeUrl(new URL($(a).attr('href'),url).href); if (target.origin===new URL(url).origin && /career|jobs|karriere|ledige|nyhet|news|contact|kontakt/i.test(label+' '+target.pathname)) links.push({url:target.href,label}); } catch {}
  });
  return {state:'available',claims,links:[...new Map(links.map(l=>[l.url,l])).values()].slice(0,4)};
}

export async function research(input, {get = request, previous, websites = false, now = () => new Date().toISOString()} = {}) {
  const started = performance.now();
  const envelope = {organisation_number:String(input),state:'failed',identity:null,claims:[],evidence:[],snapshots:[],sections:{},refresh:{},errors:[],metrics:{requests:0}};
  const successful = [];
  let org;
  try { org=orgNumber(input); envelope.organisation_number=org; }
  catch(e) { envelope.errors.push({source:'input',message:e.message}); return finish(); }
  const base='https://data.brreg.no/enhetsregisteret/api';
  async function source(family,url,transform = x=>x) {
    envelope.metrics.requests++;
    try {
      const response=await get(url);
      if (response.status!==200) { envelope.sections[family]={state:[401,403,429].includes(response.status)?'blocked':response.status===404?'not_available':'failed',reason:`HTTP ${response.status}`}; return null; }
      const data=transform(JSON.parse(response.text)); const content=canonical(data); const id=hash(content);
      const ev={id,url:response.url ?? url,retrieved_at:now(),content_hash:id,extractor:family==='leadership'?'public-role-projection (birth dates omitted)':'json',family};
      envelope.evidence.push(ev); envelope.snapshots.push({id,content:data});
      envelope.sections[family]={state:'available',evidence_id:id}; successful.push(family);
      return {data,ev};
    } catch(e) { envelope.sections[family]={state:'failed',reason:e.message}; envelope.errors.push({source:family,message:e.message}); return null; }
  }
  function add(claims,ev) {
    for (const c of claims) envelope.claims.push({...c,id:hash([org,c.field,c.value,c.reporting_period ?? null,c.scope ?? 'entity']),source_url:ev.url,retrieved_at:ev.retrieved_at,evidence_id:ev.id,extractor:c.extractor ?? ev.extractor});
  }
  const registry=await source('identity',`${base}/enheter/${org}`);
  if (!registry) return finish();
  try { add(factsFromRegistry(registry.data,org),registry.ev); envelope.identity={legal_name:registry.data.navn,organisation_number:org}; }
  catch(e) { envelope.state='ambiguous'; envelope.claims=[]; envelope.errors.push({source:'identity',message:e.message}); return finish(); }
  const accounts=await source('accounts',`https://data.brreg.no/regnskapsregisteret/regnskap/${org}`);
  if (accounts) try { const facts=financialClaims(accounts.data,org); add(facts,accounts.ev); if (!facts.length) envelope.sections.accounts.state='not_available'; } catch(e) { envelope.sections.accounts={state:'ambiguous',reason:e.message}; successful.splice(successful.indexOf('accounts'),1); }
  const roles=await source('leadership',`${base}/enheter/${org}/roller`,redactRoles);
  if (roles) {
    const claims=roles.data.rollegrupper.flatMap(g=>g.roller.filter(r=>r.name||r.organisation).map(r=>({field:'registered_role',value:{role:r.role,name:r.name,organisation:r.organisation},family:'leadership',reporting_period:g.sistEndret ?? null,scope:'entity'})));
    add(claims,roles.ev); if (!claims.length) envelope.sections.leadership.state='not_available';
  }
  const units=await source('workplaces',`${base}/underenheter?overordnetEnhet=${org}&size=100`);
  if (units) {
    const rows=units.data._embedded?.underenheter ?? [];
    add(rows.filter(r=>String(r.overordnetEnhet)===org).map(r=>({field:'registered_workplace',value:{organisation_number:r.organisasjonsnummer,name:r.navn,address:r.beliggenhetsadresse ?? r.forretningsadresse},family:'workplaces',scope:'entity'})),units.ev);
    envelope.sections.workplaces.total=units.data.page?.totalElements ?? rows.length;
    envelope.sections.workplaces.truncated=(units.data.page?.totalElements ?? 0)>rows.length;
    if (!rows.length) envelope.sections.workplaces.state='not_available';
  }
  envelope.sections.website={state:'failed',reason:websites?'No registry website candidate':'Website collection disabled; not checked'};
  envelope.sections.hiring={state:'failed',reason:'Not checked; no hiring assertion'};
  envelope.sections.activity={state:'failed',reason:'Dated website activity not checked'};
  if (websites && registry.data.hjemmeside) {
    try {
      const candidate=safeUrl(/^https?:\/\//i.test(registry.data.hjemmeside)?registry.data.hjemmeside.replace(/^http:/,'https:'):'https://'+registry.data.hjemmeside);
      envelope.metrics.requests++; const robots=await get(new URL('/robots.txt',candidate).href);
      if (![200,404].includes(robots.status) || (robots.status===200 && robotsParser(new URL('/robots.txt',candidate).href,robots.text).isAllowed(candidate.href,'SignalLedger')===false)) envelope.sections.website={state:'blocked',reason:'Robots policy denies access or could not be established'};
      else {
        envelope.metrics.requests++; const page=await get(candidate.href,{redirects:0});
        if (page.status!==200) envelope.sections.website={state:'blocked',reason:`Website HTTP ${page.status}; redirects are not followed without robots revalidation`};
        else {
          const facts=websiteFacts(page.text,org,candidate.href); const id=hash(page.text);
          const ev={id,url:candidate.href,retrieved_at:now(),content_hash:id,extractor:'html',family:'website'};
          envelope.evidence.push(ev); envelope.snapshots.push({id,content:page.text});
          envelope.sections.website={state:facts.state,reason:facts.reason ?? null,candidate_links:facts.links ?? [],evidence_id:id}; add(facts.claims,ev);
          if (facts.state==='available') successful.push('website');
        }
      }
    } catch(e) { envelope.sections.website={state:'failed',reason:e.message}; }
  }
  envelope.state='available';
  return finish();
  function finish() {
    envelope.claims=[...new Map(envelope.claims.map(c=>[c.id,c])).values()];
    envelope.refresh={checked_at:now(),previous_checked_at:previous?.refresh?.checked_at ?? null,changes:changes(previous?.claims,envelope.claims,successful),source_status:envelope.sections};
    if (!previous) envelope.refresh.changes={added:[],removed:[],unavailable_comparison:[]};
    envelope.summary=envelope.identity?`${envelope.identity.legal_name}: ${envelope.claims.length} sourced claims. Accounts retain their original reporting periods and distinguish entity from group. Unknown or unqueried sections remain explicit.`:'Identity could not be established; no facts published.';
    envelope.metrics.elapsed_ms=Math.round(performance.now()-started);
    return envelope;
  }
}
