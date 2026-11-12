// Test-only provider. Never touches a browser/account.
export async function fakeSend() { return { messageId: 'fake-only', delivery: 'submitted' }; }
