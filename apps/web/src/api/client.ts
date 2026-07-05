import { fetchAuthSession } from 'aws-amplify/auth'
import { base64ToBytes, bytesToBase64 } from './base64'

const BASE_URL = import.meta.env.VITE_HTTP_API_URL as string

export interface ProjectSummary {
  projectId: string
  name: string
  ownerId: string
  createdAt: string
  updatedAt: string
  role: 'owner' | 'collaborator'
}

export interface ProjectMember {
  projectId: string
  animatorId: string
  role: 'owner' | 'collaborator'
  invitedAt: string
  email?: string
}

export interface ProjectDetail extends ProjectSummary {
  members: ProjectMember[]
}

export interface PaletteSummary {
  paletteId: string
  ownerId: string
  name: string
  colors: string[]
  createdAt: string
  updatedAt: string
}

export async function getIdToken(): Promise<string | undefined> {
  const session = await fetchAuthSession()
  return session.tokens?.idToken?.toString()
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getIdToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed: ${res.status}`)
  return body as T
}

export function listProjects(): Promise<{ projects: ProjectSummary[] }> {
  return request('/projects')
}

export function createProject(name: string): Promise<ProjectSummary> {
  return request('/projects', { method: 'POST', body: JSON.stringify({ name }) })
}

export function getProject(projectId: string): Promise<ProjectDetail> {
  return request(`/projects/${projectId}`)
}

export function renameProject(projectId: string, name: string): Promise<{ ok: true }> {
  return request(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export function deleteProject(projectId: string): Promise<{ ok: true }> {
  return request(`/projects/${projectId}`, { method: 'DELETE' })
}

export function shareProject(projectId: string, email: string): Promise<{ ok: true }> {
  return request(`/projects/${projectId}/share`, { method: 'POST', body: JSON.stringify({ email }) })
}

export function revokeMember(projectId: string, animatorId: string): Promise<{ ok: true }> {
  return request(`/projects/${projectId}/members/${animatorId}`, { method: 'DELETE' })
}

export function listPalettes(): Promise<{ palettes: PaletteSummary[] }> {
  return request('/palettes')
}

export function createPalette(name: string, colors: string[] = []): Promise<PaletteSummary> {
  return request('/palettes', { method: 'POST', body: JSON.stringify({ name, colors }) })
}

export function updatePalette(paletteId: string, patch: { name?: string; colors?: string[] }): Promise<{ ok: true }> {
  return request(`/palettes/${paletteId}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deletePalette(paletteId: string): Promise<{ ok: true }> {
  return request(`/palettes/${paletteId}`, { method: 'DELETE' })
}

export async function loadDocument(projectId: string): Promise<Uint8Array> {
  const { snapshot } = await request<{ snapshot: string }>(`/projects/${projectId}/document`)
  return base64ToBytes(snapshot)
}

export async function saveDocument(projectId: string, bytes: Uint8Array): Promise<void> {
  await request(`/projects/${projectId}/document`, { method: 'PUT', body: JSON.stringify({ snapshot: bytesToBase64(bytes) }) })
}
