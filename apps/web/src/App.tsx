import { useState } from 'react'
import { signOut } from 'aws-amplify/auth'
import './auth/amplifyConfig'
import { useAuth } from './auth/useAuth'
import { AuthScreen } from './auth/AuthScreen'
import { Editor } from './editor/Editor'
import { ProjectDashboard } from './dashboard/ProjectDashboard'
import './App.css'

function App() {
  const { status, email } = useAuth()
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)

  if (status === 'loading') {
    return null
  }

  if (status === 'signedOut') {
    return <AuthScreen />
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>AnimationBoard</h1>
        <p>
          Signed in as <strong>{email}</strong>. <button onClick={() => signOut()}>Sign out</button>
        </p>
      </header>
      {openProjectId ? (
        <Editor animatorId={email ?? 'local'} projectId={openProjectId} onBack={() => setOpenProjectId(null)} />
      ) : (
        <ProjectDashboard onOpenProject={setOpenProjectId} />
      )}
    </main>
  )
}

export default App
