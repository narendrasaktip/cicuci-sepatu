import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerSearchWhere } from '../src/services/catalog.js';

test('customer repository filter trims names and normalizes phone searches', () => {
  assert.deepEqual(customerSearchWhere('  Narendra  '), { OR: [{ name: { contains: 'Narendra' } }, { whatsapp: { contains: 'Narendra' } }] });
  for (const value of ['0812-3456-7890', '62 (812) 3456 7890', '+62 812-3456-7890']) {
    assert.deepEqual(customerSearchWhere(value).OR?.[1], { whatsapp: { contains: '+6281234567890' } });
  }
  assert.deepEqual(customerSearchWhere('   '), {});
  assert.deepEqual(customerSearchWhere(), {});
});
