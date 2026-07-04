import { useEffect, useState } from 'react'
import { createProject, deleteProject, getProject, listProjects, renameProject, revokeMember, shareProject } from '../api/client'
import type { ProjectMember, ProjectSummary } from '../api/client'
import './ProjectDashboard.css'

interface ProjectDashboardProps {
  onOpenProject: (projectId: string) => void
}

export function ProjectDashboard({ onOpenProject }: ProjectDashboardProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [membersError, setMembersError] = useState<string | null>(null)

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

  async function toggleMembers(project: ProjectSummary) {
    if (expandedProjectId === project.projectId) {
      setExpandedProjectId(null)
      return
    }
    setExpandedProjectId(project.projectId)
    setMembers(null)
    setMembersError(null)
    try {
      const detail = await getProject(project.projectId)
      setMembers(detail.members)
    } catch (e) {
      setMembersError((e as Error).message)
    }
  }

  async function handleRevoke(project: ProjectSummary, member: ProjectMember) {
    const label = member.email ?? member.animatorId
    if (!window.confirm(`Revoke ${label}'s access to "${project.name}"?`)) return
    try {
      await revokeMember(project.projectId, member.animatorId)
      const detail = await getProject(project.projectId)
      setMembers(detail.members)
    } catch (e) {
      setMembersError((e as Error).message)
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
              <div className="project-row-main">
                <button className="project-open" onClick={() => onOpenProject(project.projectId)}>
                  <span className="project-name">{project.name}</span>
                  <span className="project-role">{project.role}</span>
                </button>
                <span className="project-updated">Updated {new Date(project.updatedAt).toLocaleString()}</span>
                <div className="project-actions">
                  <button onClick={() => toggleMembers(project)}>
                    {expandedProjectId === project.projectId ? 'Hide members' : 'Members'}
                  </button>
                  <button onClick={() => handleRename(project)}>Rename</button>
                  {project.role === 'owner' && <button onClick={() => handleShare(project)}>Share</button>}
                  {project.role === 'owner' && <button onClick={() => handleDelete(project)}>Delete</button>}
                </div>
              </div>

              {expandedProjectId === project.projectId && (
                <div className="project-members">
                  {membersError && <p className="dashboard-error">{membersError}</p>}
                  {members === null && !membersError && <p>Loading members…</p>}
                  {members?.map((member) => (
                    <div key={member.animatorId} className="project-member">
                      <span className="project-member-email">{member.email ?? member.animatorId}</span>
                      <span className="project-member-role">{member.role}</span>
                      {project.role === 'owner' && member.role === 'collaborator' && (
                        <button onClick={() => handleRevoke(project, member)}>Revoke</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
