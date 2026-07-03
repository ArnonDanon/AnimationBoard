import { createEngine } from '@animationboard/drawing-engine'
import './App.css'

const engine = createEngine()

function App() {
  return (
    <main className="scaffold">
      <h1>AnimationBoard</h1>
      <p>Epic 1 scaffold — deploy pipeline skeleton.</p>
      <p>
        <code>@animationboard/drawing-engine</code> says:{' '}
        <strong>{engine.ping()}</strong>
      </p>
    </main>
  )
}

export default App
