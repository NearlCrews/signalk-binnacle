export type AccessRecoveryState =
  | 'checking'
  | 'serving'
  | 'needs-login'
  | 'needs-admin'
  | 'access-error'
  | 'offline'
  | 'error';
