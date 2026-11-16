type StatusOrder = { aggregateStatus: string; balanceIdr: number; refundDueIdr?: number };

export function orderStatusCode(order: StatusOrder) {
  if ((order.refundDueIdr ?? 0) > 0 || order.balanceIdr < 0) return 'REFUND_PENDING';
  if (order.aggregateStatus === 'READY_FOR_PICKUP' && order.balanceIdr > 0) return 'AWAITING_PAYMENT';
  return order.aggregateStatus;
}

export const orderStatusLabels: Record<string, string> = {
  AWAITING_PAYMENT: 'Menunggu Pelunasan', REFUND_PENDING: 'Pengembalian Dana Tertunda',
  READY_FOR_PICKUP: 'Siap Diambil', COMPLETED: 'Selesai',
  RETURN_PENDING: 'Menunggu Pengembalian Sepatu', AWAITING_CONSENT: 'Menunggu Persetujuan',
};

export function orderStatusTone(code: string) {
  if (code === 'REFUND_PENDING') return 'red';
  if (code === 'AWAITING_PAYMENT' || code === 'AWAITING_CONSENT') return 'amber';
  if (code === 'READY_FOR_PICKUP') return 'teal';
  if (code === 'COMPLETED') return 'green';
  if (code === 'RETURN_PENDING') return 'slate';
  return 'blue';
}
