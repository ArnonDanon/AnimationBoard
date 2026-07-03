import { useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    checkUser();
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn' || payload.event === 'signedOut') {
        checkUser();
      }
    });
    return unsubscribe;
  }, []);

  async function checkUser() {
    try {
      const user = await getCurrentUser();
      setEmail(user.signInDetails?.loginId ?? user.username);
      setStatus('signedIn');
    } catch {
      setEmail(null);
      setStatus('signedOut');
    }
  }

  return { status, email };
}
