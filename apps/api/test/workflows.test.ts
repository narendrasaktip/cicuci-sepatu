import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { randomToken, hashToken } from '../src/lib/security.js';
const enabled = process.env.RUN_DB_TESTS === '1';
test('real DB / running proxy: multi-item workflow, consent, ledger, photos, RBAC, outbox', { skip: !enabled, timeout: 120000 }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/cicuci_sepatu_dev', 'Refusing unsafe fixture database');
  const db = new PrismaClient();
  const { deliverNotification } = await import('../src/services/notifications.js');
  const prefix = `mvp-test-${randomUUID()}`;
  const password = randomToken();
  const owner = await db.user.create({ data:{email:`${prefix}@example.test`,name:prefix,role:'OWNER',passwordHash:await argon2.hash(password)} });
  let customerId = ''; let serviceId = ''; const orderIds: string[] = []; const userIds = [owner.id];
  const base = process.env.TEST_BASE_URL ?? 'http://localhost:5173/api/v1';
  let cookie = ''; let csrf = '';
  const keys: string[] = [];
  async function call(path: string, method = 'GET', body?: unknown, expected = 200, key = randomUUID(), credentials = true) {
    const headers: Record<string,string> = {Origin:new URL(process.env.APP_BASE_URL!).origin,'Content-Type':'application/json'};
    if (credentials) { if (cookie) headers.Cookie=cookie; if (csrf) headers['X-CSRF-Token']=csrf; }
    if(method!=='GET') { headers['Idempotency-Key']=key; keys.push(key); }
    const response=await fetch(`${base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    if(path==='/auth/login' && response.status===204) cookie=response.headers.get('set-cookie')!.split(';')[0]!;
    const raw=await response.text(); const data=raw?JSON.parse(raw):null;
    assert.equal(response.status,expected,`${method} ${path}: ${raw}`); return data;
  }
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  async function photo(id:string,kind='BEFORE',visible=true){return call(`/items/${id}/photos`,'POST',{kind,customerVisible:visible,mime:'image/png',base64:png},201);}
  async function step(id:string,toStatus:string,extra:object={}){return call(`/items/${id}/transition`,'POST',{toStatus,...extra});}
  try {
    await call('/auth/login','POST',{email:owner.email,password},204);
    const me=await call('/auth/me'); csrf=me.csrfToken;
    assert.ok(csrf);
    await call('/customers','POST',{name:prefix,whatsapp:'081234567890',notificationConsent:false,unknown:1},400);
    const customer=await call('/customers','POST',{name:prefix,whatsapp:'081234567890',notificationConsent:false,notes:'INTERNAL PRIVATE'},201);customerId=customer.id;assert.equal(customer.whatsapp,'+6281234567890');
    const service=await call('/services','POST',{name:prefix,basePriceIdr:50000},201);serviceId=service.id;
    const staff=await call('/users','POST',{name:prefix,email:`staff-${prefix}@example.test`,password,role:'STAFF'},201);userIds.push(staff.id);
    const key=randomUUID();keys.push(key);
    const input={customerId,estimatedCompletionAt:new Date(Date.now()-1000).toISOString(),items:Array.from({length:3},()=>({brand:'Nike',model:'Test',color:'White',serviceId,assignedUserId:staff.id,initialNotes:'INTERNAL SHOE NOTE'}))};
    const order=await call('/orders','POST',input,201,key);orderIds.push(order.id);
    const replay=await call('/orders','POST',input,201,key);assert.equal(replay.id,order.id);assert.equal(replay.trackingToken,order.trackingToken);
    await call('/orders','POST',{...input,pickupInstructions:'different'},409,key);
    const [a,b,c]=order.items.map((i:{id:string})=>i.id);
    await step(a,'INSPECTION');await call(`/items/${a}/inspection`,'POST',{outcome:'APPROVED',notes:'ok',quotedPriceIdr:50000},409);
    for(const id of [a,b,c]) await photo(id);
    await call(`/items/${a}/photos`,'POST',{kind:'BEFORE',customerVisible:true,mime:'image/png',base64:Buffer.from('not image').toString('base64')},400);
    await call(`/items/${a}/inspection`,'POST',{outcome:'APPROVED',notes:'ok',quotedPriceIdr:50000});
    await step(b,'INSPECTION');await photo(b,'INSPECTION',false);
    await call(`/items/${b}/inspection`,'POST',{outcome:'NEEDS_CONSENT',notes:'internal inspection',risk:'Color may bleed',quotedPriceIdr:70000});
    await call(`/items/${b}/transition`,'POST',{toStatus:'WASHING'},409);
    await step(c,'INSPECTION');await call(`/items/${c}/inspection`,'POST',{outcome:'REJECTED',notes:'unsafe',quotedPriceIdr:90000});
    assert.equal((await call(`/orders/${order.id}`)).items.find((i:{id:string})=>i.id===c).finalPriceIdr,0);
    const track=await call(`/track/${order.trackingToken}`);const serialized=JSON.stringify(track);for(const secret of ['INTERNAL PRIVATE','INTERNAL SHOE NOTE','internal inspection','tokenHash','actorUserId','whatsapp','customerId'])assert.ok(!serialized.includes(secret),secret);
    const publicPhoto=track.items[0].photos[0];assert.equal((await fetch(`http://localhost:5173${publicPhoto.path}`)).status,200);
    const privatePhoto=await db.photo.findFirstOrThrow({where:{itemId:b,kind:'INSPECTION'}});await call(`/track/${order.trackingToken}/photos/${privatePhoto.id}`,'GET',undefined,404);
    const consent=await call(`/items/${b}/consent/reissue`,'POST',{});
    await call(`/track/${order.trackingToken}/consent`,'POST',{itemId:'wrong-item',decision:'APPROVE'},409,randomUUID(),false);
    await db.consentDecision.update({where:{id:consent.consentId},data:{expiresAt:new Date(Date.now()-1000)}});
    await call(`/track/${order.trackingToken}/consent`,'POST',{itemId:b,decision:'APPROVE'},410,randomUUID(),false);
    await call(`/items/${b}/consent/reissue`,'POST',{});
    const decisions=await Promise.all(['APPROVE','APPROVE'].map(decision=>fetch(`${base}/track/${order.trackingToken}/consent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({itemId:b,decision})})));
    assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
    await step(a,'WASHING');await step(a,'DRYING');await step(a,'FINISHING');await step(a,'QC');
    await call(`/items/${a}/transition`,'POST',{toStatus:'READY_FOR_PICKUP',qcPassed:true},409);
    await step(a,'REWORK',{qcPassed:false,reason:'Stain remains'});await step(a,'FINISHING');await step(a,'QC');
    const after=await photo(a,'AFTER');await step(a,'READY_FOR_PICKUP',{qcPassed:true,dryConfirmed:true,finishingConfirmed:true});
    await call(`/photos/${after.id}`,'DELETE',{},409);
    assert.equal((await call(`/orders/${order.id}`)).aggregateStatus,'READY_FOR_PICKUP');
    await call(`/orders/${order.id}/payments`,'POST',{amountIdr:120001,method:'CASH',receivedAt:new Date().toISOString()},409);
    let paid=await call(`/orders/${order.id}/payments`,'POST',{amountIdr:50000,method:'CASH',receivedAt:new Date().toISOString()},201);assert.equal(paid.paymentStatus,'PARTIAL');
    paid=await call(`/orders/${order.id}/payments`,'POST',{amountIdr:70000,method:'QRIS',receivedAt:new Date().toISOString()},201);assert.equal(paid.paymentStatus,'PAID');
    paid=await call(`/orders/${order.id}/refunds`,'POST',{amountIdr:120000,method:'CASH',reason:'Customer refund',receivedAt:new Date().toISOString()},201);assert.equal(paid.paymentStatus,'REFUNDED');
    await call(`/orders/${order.id}/refunds`,'POST',{amountIdr:1,method:'CASH',reason:'bad',receivedAt:new Date().toISOString()},409);
    await step(a,'HANDED_OVER');await step(c,'RETURNED');assert.equal((await call(`/orders/${order.id}`)).paymentStatus,'REFUNDED');
    const rotated=await call(`/orders/${order.id}/tracking-token/rotate`,'POST',{});await call(`/track/${order.trackingToken}`,'GET',undefined,404);await call(`/track/${rotated.trackingToken}`);
    await call(`/orders/${order.id}/tracking-token/revoke`,'POST',{});await call(`/track/${rotated.trackingToken}`,'GET',undefined,404);
    const events=await db.notificationEvent.findMany({where:{orderId:order.id}});assert.ok(events.length>5);assert.equal(new Set(events.map(e=>e.eventKey)).size,events.length);
    const stale=events.find(e=>e.itemId===a&&e.expectedStatus==='WASHING')!;await deliverNotification(stale.id,0);assert.equal((await db.notificationEvent.findUniqueOrThrow({where:{id:stale.id}})).status,'SKIPPED');
    const current=events.find(e=>e.itemId===a&&e.expectedStatus==='HANDED_OVER')!;await deliverNotification(current.id,0);await deliverNotification(current.id,0);assert.equal((await db.notificationEvent.findUniqueOrThrow({where:{id:current.id}})).status,'SKIPPED');assert.equal(await db.notificationAttempt.count({where:{eventId:current.id}}),1);
    const retryEvent=await db.notificationEvent.create({data:{orderId:order.id,eventKey:`${prefix}-retry`,recipient:customer.whatsapp,template:'TEST_RETRY',message:'test',optedIn:true,status:'FAILED',nextAttemptAt:new Date(Date.now()+3600000)}});
    await call(`/notifications/${retryEvent.id}/retry`,'POST',{},409);
    const optedOut=await db.notificationEvent.create({data:{orderId:order.id,eventKey:`${prefix}-optout`,recipient:customer.whatsapp,template:'TEST_OPTOUT',message:'test',optedIn:true,nextAttemptAt:new Date(Date.now()+3600000)}});await call(`/customers/${customerId}`,'PATCH',{notificationConsent:false});await deliverNotification(optedOut.id,0);assert.equal((await db.notificationEvent.findUniqueOrThrow({where:{id:optedOut.id}})).status,'SKIPPED');
    const list=await call('/orders?limit=1&q='+encodeURIComponent(prefix));assert.ok(list.data.length<=1);await call('/orders?limit=0','GET',undefined,400);await call('/orders?unknown=true','GET',undefined,400);await call('/dashboard');await call(`/notifications?orderId=${order.id}`);await call('/audit?limit=1');
    // Real login and CSRF boundary, not fabricated authorization.
    await call('/auth/login','POST',{email:staff.email,password},204);csrf=(await call('/auth/me')).csrfToken;
    await call('/customers','GET',undefined,403);await call('/settings','GET',undefined,403);await call('/users','GET',undefined,403);await call(`/orders/${order.id}`);
    const savedCsrf=csrf;csrf='bad';await call(`/items/${b}/transition`,'POST',{toStatus:'WASHING'},403);csrf=savedCsrf;
    const race=await Promise.all([1,2].map(()=>fetch(`${base}/items/${b}/transition`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,'Idempotency-Key':(()=>{const k=randomUUID();keys.push(k);return k;})()},body:JSON.stringify({toStatus:'WASHING'})})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    // Decline branch in isolated second order.
    await call('/auth/login','POST',{email:owner.email,password},204);csrf=(await call('/auth/me')).csrfToken;
    const second=await call('/orders','POST',{...input,items:[input.items[0]]},201);orderIds.push(second.id);const d=second.items[0].id;await photo(d);await photo(d,'INSPECTION',false);await step(d,'INSPECTION');const declined=await call(`/items/${d}/inspection`,'POST',{outcome:'NEEDS_CONSENT',notes:'risk',risk:'Shrinkage',quotedPriceIdr:50000});await call(`/track/${second.trackingToken}/consent`,'POST',{approvalToken:declined.consent.approvalToken,decision:'DECLINE'});assert.equal((await call(`/orders/${second.id}`)).totalIdr,0);await step(d,'RETURNED');assert.equal((await call(`/orders/${second.id}`)).aggregateStatus,'COMPLETED');
  } finally {
    // Delete only captured fixture IDs, children first. No reset/truncate/global deletion.
    const items=await db.orderItem.findMany({where:{orderId:{in:orderIds}},select:{id:true}});const itemIds=items.map(i=>i.id);
    const events=await db.notificationEvent.findMany({where:{orderId:{in:orderIds}},select:{id:true}});
    await db.notificationAttempt.deleteMany({where:{eventId:{in:events.map(e=>e.id)}}});await db.notificationEvent.deleteMany({where:{orderId:{in:orderIds}}});
    await db.photo.deleteMany({where:{itemId:{in:itemIds}}});await db.consentDecision.deleteMany({where:{itemId:{in:itemIds}}});await db.inspection.deleteMany({where:{itemId:{in:itemIds}}});await db.statusHistory.deleteMany({where:{itemId:{in:itemIds}}});await db.payment.deleteMany({where:{orderId:{in:orderIds}}});await db.orderItem.deleteMany({where:{id:{in:itemIds}}});await db.order.deleteMany({where:{id:{in:orderIds}}});
    if(customerId)await db.customer.delete({where:{id:customerId}});if(serviceId)await db.service.delete({where:{id:serviceId}});
    const sessions=await db.session.findMany({where:{userId:{in:userIds}}});
    for(const session of sessions){for(const key of keys)await db.idempotency.deleteMany({where:{id:hashToken(`${session.userId}:${session.csrfToken}:${key}`)}});}
    await db.session.deleteMany({where:{userId:{in:userIds}}});await db.auditLog.deleteMany({where:{OR:[{actorUserId:{in:userIds}},{entityId:{in:[...itemIds,...orderIds,...events.map(e=>e.id)]}}]}});await db.user.deleteMany({where:{id:{in:userIds}}});
    await db.$disconnect();
  }
});
