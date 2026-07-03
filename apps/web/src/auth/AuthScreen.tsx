import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  confirmResetPassword,
  confirmSignUp,
  resetPassword,
  signIn,
  signUp,
} from 'aws-amplify/auth';
import './AuthScreen.css';

type Mode = 'signIn' | 'signUp' | 'confirmSignUp' | 'forgotPassword' | 'resetPassword';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function withBusy(fn: () => Promise<void>) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSignIn(e: FormEvent) {
    e.preventDefault();
    withBusy(async () => {
      await signIn({ username: email, password });
    });
  }

  function handleSignUp(e: FormEvent) {
    e.preventDefault();
    withBusy(async () => {
      await signUp({ username: email, password, options: { userAttributes: { email } } });
      setMode('confirmSignUp');
      setInfo('Check your email for a confirmation code.');
    });
  }

  function handleConfirmSignUp(e: FormEvent) {
    e.preventDefault();
    withBusy(async () => {
      await confirmSignUp({ username: email, confirmationCode: code });
      setMode('signIn');
      setInfo('Account confirmed — sign in below.');
    });
  }

  function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    withBusy(async () => {
      await resetPassword({ username: email });
      setMode('resetPassword');
      setInfo('Check your email for a reset code.');
    });
  }

  function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    withBusy(async () => {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      setMode('signIn');
      setInfo('Password reset — sign in below.');
    });
  }

  return (
    <div className="auth-screen">
      <h1>AnimationBoard</h1>

      {mode === 'signIn' && (
        <form onSubmit={handleSignIn}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit" disabled={busy}>Sign in</button>
          <div className="auth-links">
            <button type="button" onClick={() => setMode('signUp')}>Create an account</button>
            <button type="button" onClick={() => setMode('forgotPassword')}>Forgot password?</button>
          </div>
        </form>
      )}

      {mode === 'signUp' && (
        <form onSubmit={handleSignUp}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <button type="submit" disabled={busy}>Register</button>
          <div className="auth-links">
            <button type="button" onClick={() => setMode('signIn')}>Back to sign in</button>
          </div>
        </form>
      )}

      {mode === 'confirmSignUp' && (
        <form onSubmit={handleConfirmSignUp}>
          <input type="text" placeholder="Confirmation code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <button type="submit" disabled={busy}>Confirm account</button>
        </form>
      )}

      {mode === 'forgotPassword' && (
        <form onSubmit={handleForgotPassword}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit" disabled={busy}>Send reset code</button>
          <div className="auth-links">
            <button type="button" onClick={() => setMode('signIn')}>Back to sign in</button>
          </div>
        </form>
      )}

      {mode === 'resetPassword' && (
        <form onSubmit={handleResetPassword}>
          <input type="text" placeholder="Reset code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <input type="password" placeholder="New password (min 8 characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
          <button type="submit" disabled={busy}>Set new password</button>
        </form>
      )}

      {info && <p className="auth-info">{info}</p>}
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
