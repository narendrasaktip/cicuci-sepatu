import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaults, previewValues, renderTemplate, routineEvents, templateWrite } from '../src/services/whatsapp-templates.js';

test('routine shoe updates render one order number and the relevant shoe', () => {
  for (const event of routineEvents) {
    const template = templateWrite.parse(defaults.find(value => value.event === event));
    const message = renderTemplate(template.body, previewValues);
    assert.equal(message.split(previewValues.nomor_pesanan).length - 1, 1, event);
    assert.ok(message.includes(previewValues.sepatu), event);
    assert.ok(message.includes(previewValues.url_tracking), event);
    assert.match(message, /^Halo Kak Dina \(contoh\),/);
    assert.match(message, /\n\nNomor pesanan: CONTOH-001\nPantau:/);
    assert.match(message, /\n\n_Salam hangat,_\n\*Cicuci Sepatu\*$/);
  }
});
