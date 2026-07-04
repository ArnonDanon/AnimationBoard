import { useEffect, useState } from 'react'
import { createProject, deleteProject, listProjects, renameProject, shareProject } from '../api/client'
import type { ProjectSummary } from '../api/client'
import './ProjectDashboard.css'

interface ProjectDashboardProps {
  onOpenProject: (projectId: string) => void
}

export function ProjectDashboard({ onOpenProject }: ProjectDashboardProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  function refresh() {
    listProjects()
      .then((res) => setProjects(res.projects))
      .catch((e) => setError((e as Error).message))
  }

  useEffect(refresh, [])

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const project = await createProject(newName.trim() || 'Untitled Project')
      setNewName('')
      onOpenProject(project.projectId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(project: ProjectSummary) {
    const name = window.prompt('Rename project', project.name)
    if (!name || !name.trim() || name.trim() === project.name) return
    try {
      await renameProject(project.projectId, name.trim())
      refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleShare(project: ProjectSummary) {
    const email = window.prompt('Share with (email of a registered AnimationBoard user, up to 2 collaborators)')
    if (!email || !email.trim()) return
    try {
      await shareProject(project.projectId, email.trim())
      refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleDelete(project: ProjectSummary) {
    if (!window.confirm(`Delete "${project.name}"? This cannot be undone.`)) return
    try {
      await deleteProject(project.projectId)
      refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="project-dashboard">
      <div className="new-project">
        <input
          type="text"
          placeholder="New project name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <button onClick={handleCreate} disabled={creating}>
          + New Project
        </button>
      </div>

      {error && <p className="dashboard-error">{error}</p>}

      {projects === null ? (
        <p>Loading projects…</p>
      ) : projects.length === 0 ? (
        <p>No projects yet — create one above to get started.</p>
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.projectId} className="project-row">
              <button className="project-open" onClick={() => onOpenProject(project.projectId)}>
                <span className="project-name">{project.name}</span>
                <span className="project-role">{project.role}</span>
              </button>
              <span className="project-updated">Updated {new Date(project.updatedAt).toLocaleString()}</span>
              <div className="project-actions">
                <button onClick={() => handleRename(project)}>Rename</button>
                {project.role === 'owner' && <button onClick={() => handleShare(project)}>Share</button>}
                {project.role === 'owner' && <button onClick={() => handleDelete(project)}>Delete</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
