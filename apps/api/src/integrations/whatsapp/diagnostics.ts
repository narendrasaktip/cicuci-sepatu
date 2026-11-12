export type InitializationDiagnostic = { stage: 'factory' | 'initialize'; errorType: string; diagnosticCode: string; operation: string };
// Fixed vocabularies only. Even exception names/codes can contain caller-supplied secrets.
export function initializationDiagnostic(error: unknown, stage: InitializationDiagnostic['stage']): InitializationDiagnostic {
  const name = error instanceof Error ? error.name : '';
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  const stack = error instanceof Error ? error.stack ?? '' : '';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return {
    stage,
    errorType: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'TimeoutError', 'ProtocolError', 'TargetCloseError'].includes(name) ? name : typeof error === 'string' ? 'String' : 'Unknown',
    diagnosticCode: typeof code === 'string' && ['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'EEXIST', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code) ? code : /Invalid parameters/i.test(message) ? 'INVALID_PARAMETERS' : /Execution context was destroyed/i.test(message) ? 'CONTEXT_DESTROYED' : /Evaluation failed/i.test(message) ? 'EVALUATION_FAILED' : 'UNKNOWN',
    operation: /setUserAgent|Network\.setUserAgentOverride|Emulation\.setUserAgentOverride/.test(stack + message) ? 'setUserAgent' : /Client\.inject/.test(stack) ? 'inject' : /Page\.goto|Frame\.goto/.test(stack) ? 'navigation' : /launch/.test(stack) ? 'launch' : 'unknown',
  };
}
// Classify locally; never return exception text, paths, URLs, QR data or account details.
export function initializationCause(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (/SingletonLock|ProcessSingleton|profile.*in use|user data directory.*in use/i.test(message)) return 'BROWSER_PROFILE_LOCKED';
  if (code === 'EACCES' || code === 'EPERM' || /permission denied|operation not permitted/i.test(message)) return 'BROWSER_PERMISSION_DENIED';
  if (code === 'ENOENT' || /could not find (?:chrome|chromium)|browser was not found|executable.*(?:not found|does not exist)|spawn.*ENOENT/i.test(message)) return 'BROWSER_NOT_FOUND';
  if (/no usable sandbox|running as root without --no-sandbox/i.test(message)) return 'BROWSER_SANDBOX_FAILED';
  if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_PROXY_CONNECTION|ERR_CERT_|net::/i.test(message)) return 'WHATSAPP_NETWORK_FAILED';
  if (/timed?\s*out|TimeoutError/i.test(message) || error instanceof Error && error.name === 'TimeoutError') return 'INITIALIZATION_TIMEOUT';
  if (/failed to launch|browser.*(?:closed|disconnected)|target closed|session closed/i.test(message)) return 'BROWSER_LAUNCH_FAILED';
  if (/Protocol error|Invalid parameters/i.test(message)) return 'BROWSER_PROTOCOL_FAILED';
  if (/Evaluation failed|Execution context was destroyed/i.test(message)) return 'WHATSAPP_PAGE_FAILED';
  return 'INITIALIZATION_FAILED';
}

export type SendDiagnostic = { stage: 'send'; errorType: string; diagnosticCode: string; operation: 'sendMessage' };
// Fixed vocabularies only; never return exception text, recipient, message or IDs.
export function sendDiagnostic(error: unknown): SendDiagnostic {
  const name = error instanceof Error ? error.name : '';
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return {
    stage: 'send',
    errorType: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'TimeoutError', 'ProtocolError', 'TargetCloseError'].includes(name) ? name : typeof error === 'string' ? 'String' : 'Unknown',
    diagnosticCode: typeof code === 'string' && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code) ? code : /Invalid parameters/i.test(message) ? 'INVALID_PARAMETERS' : /Execution context was destroyed/i.test(message) ? 'CONTEXT_DESTROYED' : /Evaluation failed/i.test(message) ? 'EVALUATION_FAILED' : 'UNKNOWN',
    operation: 'sendMessage',
  };
}

export function controlFailure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return ['INVALID_COMMAND', 'COMMAND_EXPIRED', 'FORBIDDEN', 'NOT_READY', 'AUTH_FAILED', 'LOGOUT_FAILED', 'BROWSER_CLOSE_FAILED', 'SESSION_DELETE_FAILED', 'BROWSER_PROFILE_LOCKED', 'BROWSER_PERMISSION_DENIED', 'BROWSER_NOT_FOUND', 'BROWSER_SANDBOX_FAILED', 'WHATSAPP_NETWORK_FAILED', 'INITIALIZATION_TIMEOUT', 'BROWSER_LAUNCH_FAILED', 'INITIALIZATION_FAILED', 'BROWSER_PROTOCOL_FAILED', 'WHATSAPP_PAGE_FAILED'].includes(code) ? code : initializationCause(error);
}
