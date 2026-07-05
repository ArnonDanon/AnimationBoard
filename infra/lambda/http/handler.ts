import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { createDocument, exportSnapshot } from '@animationboard/drawing-engine/document-model';

// removeUndefinedValues: getCallerEmail() can return undefined (e.g. a token missing
// the email claim), and PutCommand would otherwise throw rather than just omitting it.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});
const apiGw = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_ENDPOINT! });

const PROJECTS_TABLE = process.env.PROJECTS_TABLE!;
const MEMBERS_TABLE = process.env.MEMBERS_TABLE!;
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const PALETTES_TABLE = process.env.PALETTES_TABLE!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

// Matches the Project aggregate invariant in docs/01-domain-model.md (owner + up to 2
// collaborators for the POC).
const MAX_MEMBERS = 3;

interface Membership {
  projectId: string;
  animatorId: string;
  role: 'owner' | 'collaborator';
  invitedAt: string;
  // Denormalized at write time (snapshot, not a live reference — same pattern the
  // domain model already uses for Personal Library -> Document) so listing/viewing
  // members never needs a Cognito lookup. Absent on rows created before this field
  // existed.
  email?: string;
}

interface Connection {
  connectionId: string;
  projectId: string;
  animatorId: string;
}

interface Project {
  projectId: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

interface Palette {
  paletteId: string;
  ownerId: string;
  name: string;
  colors: string[];
  createdAt: string;
  updatedAt: string;
}

function respond(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function getCallerId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  return String(event.requestContext.authorizer.jwt.claims.sub);
}

function getCallerEmail(event: APIGatewayProxyEventV2WithJWTAuthorizer): string | undefined {
  const email = event.requestContext.authorizer.jwt.claims.email;
  return typeof email === 'string' ? email : undefined;
}

function documentKey(projectId: string): string {
  return `documents/${projectId}.bin`;
}

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): Record<string, unknown> {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

async function getMembership(projectId: string, animatorId: string): Promise<Membership | undefined> {
  const result = await ddb.send(new GetCommand({ TableName: MEMBERS_TABLE, Key: { projectId, animatorId } }));
  return result.Item as Membership | undefined;
}

async function getMembers(projectId: string): Promise<Membership[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: MEMBERS_TABLE,
      KeyConditionExpression: 'projectId = :p',
      ExpressionAttributeValues: { ':p': projectId },
    }),
  );
  return (result.Items ?? []) as Membership[];
}

async function createProject(event: APIGatewayProxyEventV2WithJWTAuthorizer, callerId: string): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled Project';
  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();

  await ddb.send(new PutCommand({ TableName: PROJECTS_TABLE, Item: { projectId, name, ownerId: callerId, createdAt: now, updatedAt: now } }));
  await ddb.send(
    new PutCommand({
      TableName: MEMBERS_TABLE,
      Item: { projectId, animatorId: callerId, role: 'owner', invitedAt: now, email: getCallerEmail(event) },
    }),
  );

  // Seed an empty document immediately so load-document never has to special-case
  // "project exists but nothing was ever saved yet".
  await s3.send(new PutObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: documentKey(projectId), Body: Buffer.from(exportSnapshot(createDocument())) }));

  return respond(201, { projectId, name, ownerId: callerId, createdAt: now, updatedAt: now, role: 'owner' });
}

async function listProjects(callerId: string): Promise<APIGatewayProxyResultV2> {
  const memberships = await ddb.send(
    new QueryCommand({
      TableName: MEMBERS_TABLE,
      IndexName: 'byAnimator',
      KeyConditionExpression: 'animatorId = :a',
      ExpressionAttributeValues: { ':a': callerId },
    }),
  );
  const items = (memberships.Items ?? []) as Membership[];
  if (items.length === 0) return respond(200, { projects: [] });

  const batch = await ddb.send(new BatchGetCommand({ RequestItems: { [PROJECTS_TABLE]: { Keys: items.map((m) => ({ projectId: m.projectId })) } } }));
  const projectsById = new Map((batch.Responses?.[PROJECTS_TABLE] as Project[] | undefined ?? []).map((p) => [p.projectId, p]));
  const projects = items
    .map((m) => {
      const project = projectsById.get(m.projectId);
      return project ? { ...project, role: m.role } : undefined;
    })
    .filter((p): p is Project & { role: Membership['role'] } => p !== undefined);

  return respond(200, { projects });
}

async function getProject(projectId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  const membership = await getMembership(projectId, callerId);
  if (!membership) return respond(403, { error: 'not a member of this project' });

  const project = await ddb.send(new GetCommand({ TableName: PROJECTS_TABLE, Key: { projectId } }));
  if (!project.Item) return respond(404, { error: 'project not found' });

  const members = await getMembers(projectId);
  return respond(200, { ...project.Item, role: membership.role, members });
}

async function renameProject(event: APIGatewayProxyEventV2WithJWTAuthorizer, projectId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  const membership = await getMembership(projectId, callerId);
  if (!membership) return respond(403, { error: 'not a member of this project' });

  const body = parseBody(event);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return respond(400, { error: 'name is required' });

  await ddb.send(
    new UpdateCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      UpdateExpression: 'SET #name = :name, updatedAt = :now',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: { ':name': name, ':now': new Date().toISOString() },
    }),
  );
  return respond(200, { ok: true });
}

async function deleteProject(projectId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  const membership = await getMembership(projectId, callerId);
  if (!membership || membership.role !== 'owner') return respond(403, { error: 'only the owner can delete this project' });

  const members = await getMembers(projectId);
  await Promise.all(members.map((m) => ddb.send(new DeleteCommand({ TableName: MEMBERS_TABLE, Key: { projectId, animatorId: m.animatorId } }))));
  await ddb.send(new DeleteCommand({ TableName: PROJECTS_TABLE, Key: { projectId } }));
  return respond(200, { ok: true });
}

async function shareProject(event: APIGatewayProxyEventV2WithJWTAuthorizer, projectId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  const membership = await getMembership(projectId, callerId);
  if (!membership || membership.role !== 'owner') return respond(403, { error: 'only the owner can share this project' });

  const body = parseBody(event);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return respond(400, { error: 'email is required' });

  const members = await getMembers(projectId);
  if (members.length >= MAX_MEMBERS) return respond(409, { error: `projects are limited to ${MAX_MEMBERS} members in this POC` });

  const users = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `email = "${email}"`, Limit: 1 }));
  const sub = users.Users?.[0]?.Attributes?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) return respond(404, { error: 'no registered user with that email' });

  if (await getMembership(projectId, sub)) return respond(409, { error: 'already a member of this project' });

  await ddb.send(
    new PutCommand({
      TableName: MEMBERS_TABLE,
      Item: { projectId, animatorId: sub, role: 'collaborator', invitedAt: new Date().toISOString(), email },
    }),
  );
  return respond(201, { ok: true });
}

async function revokeMember(projectId: string, targetAnimatorId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  const callerMembership = await getMembership(projectId, callerId);
  if (!callerMembership || callerMembership.role !== 'owner') return respond(403, { error: 'only the owner can revoke access' });

  const target = await getMembership(projectId, targetAnimatorId);
  if (!target) return respond(404, { error: 'not a member of this project' });
  if (target.role === 'owner') return respond(400, { error: "the owner's own access can't be revoked this way — delete the project instead" });

  await ddb.send(new DeleteCommand({ TableName: MEMBERS_TABLE, Key: { projectId, animatorId: targetAnimatorId } }));

  // Membership is gone, so the revoked user can never reconnect (the $connect
  // authorizer re-checks membership on every handshake) — but an already-open socket
  // isn't automatically dropped. Kick any live connection(s) now so revoke takes
  // effect immediately rather than on their next reload.
  const connections = await ddb.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'byAnimator',
      KeyConditionExpression: 'animatorId = :a AND projectId = :p',
      ExpressionAttributeValues: { ':a': targetAnimatorId, ':p': projectId },
    }),
  );
  const targetConnections = (connections.Items ?? []) as Connection[];
  await Promise.all(
    targetConnections.map(async (conn) => {
      try {
        await apiGw.send(new PostToConnectionCommand({ ConnectionId: conn.connectionId, Data: Buffer.from(JSON.stringify({ type: 'revoked' })) }));
      } catch (err) {
        if (!(err instanceof GoneException)) throw err;
      }
    }),
  );

  return respond(200, { ok: true });
}

async function createPalette(event: APIGatewayProxyEventV2WithJWTAuthorizer, callerId: string): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled Palette';
  const colors = Array.isArray(body.colors) ? body.colors.filter((c): c is string => typeof c === 'string') : [];
  const paletteId = crypto.randomUUID();
  const now = new Date().toISOString();

  const palette: Palette = { paletteId, ownerId: callerId, name, colors, createdAt: now, updatedAt: now };
  await ddb.send(new PutCommand({ TableName: PALETTES_TABLE, Item: palette }));
  return respond(201, palette);
}

async function listPalettes(callerId: string): Promise<APIGatewayProxyResultV2> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: PALETTES_TABLE,
      IndexName: 'byOwner',
      KeyConditionExpression: 'ownerId = :o',
      ExpressionAttributeValues: { ':o': callerId },
    }),
  );
  return respond(200, { palettes: result.Items ?? [] });
}

async function getOwnedPalette(paletteId: string, callerId: string): Promise<Palette | undefined> {
  const result = await ddb.send(new GetCommand({ TableName: PALETTES_TABLE, Key: { paletteId } }));
  const palette = result.Item as Palette | undefined;
  return palette && palette.ownerId === callerId ? palette : undefined;
}

async function updatePalette(event: APIGatewayProxyEventV2WithJWTAuthorizer, paletteId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  if (!(await getOwnedPalette(paletteId, callerId))) return respond(403, { error: 'not the owner of this palette' });

  const body = parseBody(event);
  const updates: string[] = [];
  const values: Record<string, unknown> = { ':now': new Date().toISOString() };
  const names: Record<string, string> = {};

  if (typeof body.name === 'string' && body.name.trim()) {
    updates.push('#name = :name');
    names['#name'] = 'name';
    values[':name'] = body.name.trim();
  }
  if (Array.isArray(body.colors)) {
    updates.push('colors = :colors');
    values[':colors'] = body.colors.filter((c): c is string => typeof c === 'string');
  }
  if (updates.length === 0) return respond(400, { error: 'name and/or colors is required' });

  await ddb.send(
    new UpdateCommand({
      TableName: PALETTES_TABLE,
      Key: { paletteId },
      UpdateExpression: `SET ${updates.join(', ')}, updatedAt = :now`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
    }),
  );
  return respond(200, { ok: true });
}

async function deletePalette(paletteId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  if (!(await getOwnedPalette(paletteId, callerId))) return respond(403, { error: 'not the owner of this palette' });

  await ddb.send(new DeleteCommand({ TableName: PALETTES_TABLE, Key: { paletteId } }));
  return respond(200, { ok: true });
}

async function loadDocument(projectId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  const membership = await getMembership(projectId, callerId);
  if (!membership) return respond(403, { error: 'not a member of this project' });

  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: documentKey(projectId) }));
    const bytes = await obj.Body!.transformToByteArray();
    return respond(200, { snapshot: Buffer.from(bytes).toString('base64') });
  } catch (err) {
    if (err instanceof Error && err.name === 'NoSuchKey') return respond(404, { error: 'document not found' });
    throw err;
  }
}

async function saveDocument(event: APIGatewayProxyEventV2WithJWTAuthorizer, projectId: string, callerId: string): Promise<APIGatewayProxyResultV2> {
  const membership = await getMembership(projectId, callerId);
  if (!membership) return respond(403, { error: 'not a member of this project' });

  const body = parseBody(event);
  if (typeof body.snapshot !== 'string') return respond(400, { error: 'snapshot (base64) is required' });

  await s3.send(new PutObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: documentKey(projectId), Body: Buffer.from(body.snapshot, 'base64') }));
  await ddb.send(
    new UpdateCommand({
      TableName: PROJECTS_TABLE,
      Key: { projectId },
      UpdateExpression: 'SET updatedAt = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }),
  );
  return respond(200, { ok: true });
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const callerId = getCallerId(event);
  const method = event.requestContext.http.method;
  const segments = event.rawPath.split('/').filter(Boolean);

  try {
    if (segments[0] === 'palettes') {
      if (segments.length === 1) {
        if (method === 'POST') return await createPalette(event, callerId);
        if (method === 'GET') return await listPalettes(callerId);
      }
      if (segments.length === 2) {
        const [, paletteId] = segments;
        if (method === 'PATCH') return await updatePalette(event, paletteId, callerId);
        if (method === 'DELETE') return await deletePalette(paletteId, callerId);
      }
      return respond(404, { error: 'not found' });
    }

    if (segments[0] !== 'projects') return respond(404, { error: 'not found' });

    if (segments.length === 1) {
      if (method === 'POST') return await createProject(event, callerId);
      if (method === 'GET') return await listProjects(callerId);
    }

    if (segments.length === 2) {
      const [, projectId] = segments;
      if (method === 'GET') return await getProject(projectId, callerId);
      if (method === 'PATCH') return await renameProject(event, projectId, callerId);
      if (method === 'DELETE') return await deleteProject(projectId, callerId);
    }

    if (segments.length === 3) {
      const [, projectId, action] = segments;
      if (action === 'share' && method === 'POST') return await shareProject(event, projectId, callerId);
      if (action === 'document' && method === 'GET') return await loadDocument(projectId, callerId);
      if (action === 'document' && method === 'PUT') return await saveDocument(event, projectId, callerId);
    }

    if (segments.length === 4) {
      const [, projectId, action, memberId] = segments;
      if (action === 'members' && method === 'DELETE') return await revokeMember(projectId, memberId, callerId);
    }

    return respond(404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return respond(500, { error: 'internal error' });
  }
};
