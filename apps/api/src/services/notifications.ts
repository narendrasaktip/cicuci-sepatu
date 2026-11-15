import { broadcastPayload, deliveryPayload, unseal } from './whatsapp-templates.js';
import { recordActivity } from '../lib/audit.js';
import { sendDiagnostic } from '../integrations/whatsapp/diagnostics.js';
import type { WhatsAppMessage } from '../integrations/whatsapp/types.js';
import { QrPreparationError } from '../integrations/whatsapp/web.js';
import { transaction, lockOrder } from '../repositories/orders.js';
import { check, getOrder } from './orders.js';
type RealProvider = { activation: string | null; ready: boolean; send: (input: WhatsAppMessage) => Promise<object> };
// Claim commits before browser I/O. Ambiguous failures are never automatically retried.
export async function deliverNotification(id: string, generation: number, real?: RealProvider) {
  const result = await transaction(async tx => {
    const initial = await tx.notificationEvent.findUnique({ where: { id } }); check(initial, 'NOT_FOUND', 404);
    if (initial.orderId) {
      await lockOrder(tx, initial.orderId, true);
      await tx.$queryRaw`SELECT Customer.id FROM Customer INNER JOIN \`Order\` ON \`Order\`.customerId = Customer.id WHERE \`Order\`.id = ${initial.orderId} FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT id FROM NotificationEvent WHERE id = ${id} FOR UPDATE`;
    const event = await tx.notificationEvent.findUniqueOrThrow({ where: { id }, include: { attempts: true, order: { include: { customer: true } } } });
    if (event.provider !== 'whatsapp-web.js') return { retry: false }; // Historical providers are immutable, never replayed.
    if (event.generation !== generation || ['SENT','SIMULATED','SKIPPED','FAILED'].includes(event.status)) return { retry: false };
    if (event.eventKey.startsWith('consent-reminder:') && event.nextAttemptAt > new Date()) return { retry: false };
    const batch = event.attempts.filter(a => { const response = a.response as { generation?: number }; return response.generation === generation; });
    if (batch.length >= 5) { await tx.notificationEvent.update({ where:{id},data:{status:'FAILED'} }); return { retry: false, audit: { action: 'NOTIFICATION_FAILED', reason: 'ATTEMPTS_EXHAUSTED', actualOutbound: false } }; }
    let skip: string | undefined;
    const order = event.order;
    if (order?.archivedAt || order?.customer.archivedAt) skip = 'ARCHIVED';
    if (event.provider === 'whatsapp-web.js' && (!real?.activation || event.activation !== real.activation)) skip = 'ACTIVATION_CHANGED';
    const broadcast = event.template === 'SERVICE_BROADCAST';
    if (event.provider === 'whatsapp-web.js' && !order && !broadcast) skip = 'NO_CUSTOMER';
    if (!event.optedIn || (order && !order.customer.notificationConsentAt)) skip = 'NO_CURRENT_OPT_IN';
    if (order && order.customer.whatsapp !== event.recipient) skip = 'RECIPIENT_CHANGED';
    if (order?.aggregateStatus === 'COMPLETED' && event.template !== 'HANDED_OVER' && event.template !== 'RETURNED') skip = 'STALE_ORDER';
    if (['READY_FOR_PICKUP', 'PICKUP_BILL_UNPAID', 'PICKUP_BILL_PAID'].includes(event.template) && order?.aggregateStatus !== 'READY_FOR_PICKUP') skip = 'STALE_ORDER';
    // Order row lock serializes financial claims; unresolved submissions fence later sends.
    if (!skip && order && ['PICKUP_BILL_UNPAID', 'PICKUP_BILL_PAID'].includes(event.template)) {
      const others = await tx.notificationEvent.findMany({ where: { orderId: order.id, id: { not: id }, provider: 'whatsapp-web.js', template: { in: ['PICKUP_BILL_UNPAID', 'PICKUP_BILL_PAID'] }, status: { in: ['PROCESSING', 'FAILED'] } }, include: { attempts: true } });
      if (others.some(other => other.status === 'PROCESSING' || !other.attempts.length || other.attempts.some(attempt => attempt.status === 'PROCESSING' || (attempt.response as { actualOutbound?: unknown } | null)?.actualOutbound !== false))) {
        await tx.notificationEvent.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() + 30000) } });
        return { retry: false };
      }
    }
    let balance: number | undefined; let total: number | undefined;
    if (!skip && order && ['PICKUP_BILL_UNPAID', 'PICKUP_BILL_PAID'].includes(event.template)) {
      const finances = await getOrder(tx, order.id);
      balance = finances.balanceIdr; total = finances.totalIdr;
      if ((event.template === 'PICKUP_BILL_UNPAID') !== (balance > 0)) skip = 'STALE_BALANCE';
    }
    const initialPrefix = 'consent-initial:'; const reminderPrefix = 'consent-reminder:';
    const consentId = event.eventKey.startsWith(initialPrefix) ? event.eventKey.slice(initialPrefix.length) : event.eventKey.startsWith(reminderPrefix) ? event.eventKey.slice(reminderPrefix.length) : event.template === 'CONSENT_REQUEST' ? event.eventKey : undefined;
    if (event.itemId && event.expectedStatus) {
      const item = await tx.orderItem.findUnique({ where:{id:event.itemId} });
      if (item?.status !== event.expectedStatus) skip = 'STALE_STATE';
      if (consentId) { const consent = await tx.consentDecision.findUnique({ where:{ id:consentId } }); if (!consent || consent.itemId !== event.itemId || consent.consumedAt || consent.expiresAt <= new Date()) skip = 'STALE_CONSENT'; }
    }
    if (!skip && event.eventKey.startsWith(reminderPrefix)) {
      const initial = await tx.notificationEvent.findUnique({ where: { eventKey: `${initialPrefix}${consentId}` }, include: { attempts: true } });
      if (!initial || ['FAILED', 'SKIPPED', 'SIMULATED'].includes(initial.status)) skip = 'INITIAL_NOT_SENT';
      else if (initial.status !== 'SENT') { await tx.notificationEvent.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() + 60000) } }); return { retry: false }; }
      else {
        const sent = initial.attempts.find(a => a.status === 'SENT');
        if (!sent) skip = 'INITIAL_NOT_SENT';
        else if (initial.updatedAt.getTime() + 24 * 3600000 > Date.now()) { await tx.notificationEvent.update({ where: { id }, data: { nextAttemptAt: new Date(initial.updatedAt.getTime() + 24 * 3600000) } }); return { retry: false }; }
      }
    }
    let customerMessage = '';
    if (!skip) {
      try {
        if (!event.encryptedMessage) throw new Error('LEGACY_MESSAGE');
        if (broadcast) {
          const payload = broadcastPayload.parse(unseal(event.encryptedMessage));
          if (event.orderId || event.itemId || event.eventKey !== `broadcast:${payload.campaignId}:${payload.customerId}`) throw new Error('INVALID_BROADCAST');
          await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${payload.customerId} FOR UPDATE`;
          const customer = await tx.customer.findUnique({ where: { id: payload.customerId } });
          if (!customer || customer.archivedAt || !customer.notificationConsentAt) skip = 'NO_CURRENT_OPT_IN';
          else if (customer.whatsapp !== event.recipient) skip = 'RECIPIENT_CHANGED';
          else customerMessage = payload.message;
        } else {
          const payload = deliveryPayload.parse(unseal(event.encryptedMessage));
          if (!order?.trackingHash || payload.trackingHash !== order.trackingHash) skip = 'TRACKING_CHANGED';
          else if (event.template === 'PICKUP_BILL_UNPAID') {
            if (balance === undefined || !payload.balanceMarker || !payload.message.includes(payload.balanceMarker)) skip = 'MESSAGE_UNAVAILABLE';
            else customerMessage = payload.message.replaceAll(payload.balanceMarker, `Rp${balance.toLocaleString('id-ID')}`) + `\n\nTotal pesanan: Rp${total!.toLocaleString('id-ID')}. Saldo berlaku saat pengiriman; pembayaran dikonfirmasi manual oleh toko, bukan secara real-time. Jika sudah membayar, mohon konfirmasi ke toko.`;
          } else customerMessage = payload.message + (event.template === 'PICKUP_BILL_PAID' && total !== undefined ? `\n\nTotal pesanan: Rp${total.toLocaleString('id-ID')}.` : '');
        }
      } catch { skip = 'MESSAGE_UNAVAILABLE'; }
    }
    if (event.status === 'PROCESSING') return { retry: false };
    if (!skip && event.provider === 'whatsapp-web.js') {
      if (!real?.ready) {
        const attemptNo = event.attempts.reduce((n,a)=>Math.max(n,a.attemptNo),0)+1;
        await tx.notificationAttempt.create({ data: { eventId:id, attemptNo, provider:event.provider, status:'FAILED', response:{ generation, error:'PROVIDER_NOT_READY', actualOutbound:false } } });
        const retry = batch.length + 1 < 5;
        await tx.notificationEvent.update({ where:{id}, data:{ status:retry?'PENDING':'FAILED', nextAttemptAt:new Date(Date.now()+1000*2**batch.length) } });
        return {retry, audit: { action: 'NOTIFICATION_ATTEMPT_FAILED', reason: 'PROVIDER_NOT_READY', attemptNo, actualOutbound: false, retryable: retry }};
      }
      const attemptNo = event.attempts.reduce((n,a)=>Math.max(n,a.attemptNo),0)+1;
      await tx.notificationAttempt.create({ data: { eventId: id, attemptNo, provider: event.provider, status: 'PROCESSING', response: { generation, actualOutbound: false, delivery: 'claimed' } } });
      await tx.notificationEvent.update({ where: { id }, data: { status: 'PROCESSING' } });
      return { retry: false, claim: { attemptNo, input: { eventKey: event.eventKey, recipient: event.recipient, message: customerMessage, ...(event.template === 'PICKUP_BILL_UNPAID' ? { qr: true } : {}) } } };
    }
    const attemptNo = event.attempts.reduce((n,a)=>Math.max(n,a.attemptNo),0)+1;
    await tx.notificationAttempt.create({ data: { eventId:id, attemptNo, provider:event.provider, status:'SKIPPED', response:{ delivery:'skipped', reason:skip, generation, actualOutbound:false } } });
    await tx.notificationEvent.update({ where:{id}, data:{status:'SKIPPED'} });
    return {retry:false, audit: { action: 'NOTIFICATION_SKIPPED', reason: skip, attemptNo, actualOutbound: false }};
  });
  if (result.audit) {
    const { action, ...metadata } = result.audit;
    await recordActivity({ action, entityType: 'NotificationEvent', entityId: id, metadata: { ...metadata, generation } });
  }
  if (result.claim && real) {
    await recordActivity({ action: 'NOTIFICATION_ATTEMPT', entityType: 'NotificationEvent', entityId: id, metadata: { generation, attemptNo: result.claim.attemptNo, actualOutbound: false, delivery: 'claimed' } });
    let response: object; let status: 'SENT' | 'FAILED'; let diagnostic: object = {}; let preSubmitFailure = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      response = { ...await Promise.race([real.send(result.claim.input), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('SEND_TIMEOUT')), 30000); })]), generation, actualOutbound: true };
      status = 'SENT';
    } catch (error) {
      // Only locally identified media preparation failures prove submission never started.
      preSubmitFailure = error instanceof QrPreparationError;
      diagnostic = sendDiagnostic(error);
      status = 'FAILED'; response = { generation, actualOutbound: preSubmitFailure ? false : 'unknown', error: preSubmitFailure ? 'QR_PREPARATION_FAILED' : 'AMBIGUOUS_SEND_MANUAL_REVIEW', retryable: false, ...diagnostic };
    }
    finally { clearTimeout(timeout); }
    const missingId = status === 'SENT' && (response as { messageIdMissing?: boolean }).messageIdMissing === true;
    await recordActivity({ action: status === 'SENT' ? 'NOTIFICATION_SENT' : 'NOTIFICATION_FAILED', entityType: 'NotificationEvent', entityId: id, metadata: { generation, attemptNo: result.claim.attemptNo, actualOutbound: status === 'SENT' ? true : preSubmitFailure ? false : 'unknown', ...(status === 'SENT' ? { delivery: 'submitted', ...(missingId ? { messageIdMissing: true } : {}) } : { reason: preSubmitFailure ? 'QR_PREPARATION_FAILED' : 'AMBIGUOUS_SEND_MANUAL_REVIEW', retryable: false, ...diagnostic }) } });
    try {
      await transaction(async tx => {
        await tx.notificationAttempt.update({ where: { eventId_attemptNo: { eventId: id, attemptNo: result.claim!.attemptNo } }, data: { status, response } });
        await tx.notificationEvent.update({ where: { id }, data: { status } });
      });
    } catch {
      // Send already happened; persistence failure must not trigger a resend. Event stays PROCESSING for manual review.
      await recordActivity({ action: 'NOTIFICATION_PERSIST_FAILED', entityType: 'NotificationEvent', entityId: id, metadata: { generation, attemptNo: result.claim.attemptNo, actualOutbound: status === 'SENT' ? true : 'unknown', stage: 'send', operation: 'sendMessage', retryable: false } });
    }
  }
  if (result.retry) throw new Error('DELIVERY_RETRY');
}
