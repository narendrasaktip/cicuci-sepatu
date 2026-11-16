import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackInput, maskedFeedbackName } from '../src/services/feedback.js';

test('publication requires explicit consent; customer name stays masked', () => {
  assert.equal(feedbackInput.parse({ rating: 5, review: 'Bagus' }).publicationConsent, false);
  assert.equal(feedbackInput.parse({ rating: 5, review: 'Bagus', publicationConsent: true }).publicationConsent, true);
  assert.equal(feedbackInput.safeParse({ rating: 5, review: 'Bagus', publicationConsent: 'true' }).success, false);
  assert.equal(maskedFeedbackName(' Ayu Budi '), 'A***');
  assert.equal(maskedFeedbackName(''), 'P***');
});
