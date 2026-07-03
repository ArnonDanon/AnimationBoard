import { createEngine } from '@animationboard/drawing-engine'
import { signOut } from 'aws-amplify/auth'
import './auth/amplifyConfig'
import { useAuth } from './auth/useAuth'
import { AuthScreen } from './auth/AuthScreen'
import './App.css'

const engine = createEngine()

function App() {
  const { status, email } = useAuth()

  if (status === 'loading') {
    return null
  }

  if (status === 'signedOut') {
    return <AuthScreen />
  }

  return (
    <main className="scaffold">
      <h1>AnimationBoard</h1>
      <p>Signed in as <strong>{email}</strong>. <button onClick={() => signOut()}>Sign out</button></p>
      <p>
        <code>@animationboard/drawing-engine</code> says:{' '}
        <strong>{engine.ping()}</strong>
      </p>
    </main>
  )
}

export default App
