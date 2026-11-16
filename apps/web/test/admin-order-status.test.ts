import assert from 'node:assert/strict';
import { adminOrderStatus, labels, label, statusName, titleCaseStatus } from '../src/services/domain.ts';

for (const balanceIdr of [90000, 45000]) {
  assert.equal(adminOrderStatus({ aggregateStatus: 'READY_FOR_PICKUP', balanceIdr }), 'Menunggu Pelunasan');
}
for (const balanceIdr of [0]) {
  assert.equal(adminOrderStatus({ aggregateStatus: 'READY_FOR_PICKUP', balanceIdr }), 'Siap Diambil');
}
for (const [aggregateStatus, expected] of [['IN_PROGRESS', 'Diproses'], ['COMPLETED', 'Selesai'], ['RETURN_PENDING', 'Menunggu Pengembalian Sepatu']]) {
  for (const balanceIdr of [0, 90000]) assert.equal(adminOrderStatus({ aggregateStatus: aggregateStatus!, balanceIdr }), expected);
}
assert.equal(adminOrderStatus({ aggregateStatus: 'READY_FOR_PICKUP', balanceIdr: 90000 }, { 'admin.READY_FOR_PICKUP': 'Siap diambil' }), 'Menunggu Pelunasan');
assert.equal(adminOrderStatus({ aggregateStatus: 'IN_PROGRESS', balanceIdr: 0 }, { 'admin.IN_PROGRESS': 'Sedang dirawat' }), 'Sedang Dirawat');
assert.equal(adminOrderStatus({ aggregateStatus: 'COMPLETED', balanceIdr: -10000 }), 'Pengembalian Dana Tertunda');
assert.equal(adminOrderStatus({ aggregateStatus: 'RETURN_PENDING', balanceIdr: 0, refundDueIdr: 10000 }), 'Pengembalian Dana Tertunda');
assert.equal(statusName({ 'admin.AWAITING_CONSENT': 'Menunggu persetujuan' }, 'admin', 'AWAITING_CONSENT'), 'Menunggu Persetujuan');
for (const code of Object.keys(labels)) {
  assert.equal(label(code), titleCaseStatus(label(code)));
  assert.equal(statusName(undefined, 'admin', code), titleCaseStatus(label(code)));
}
