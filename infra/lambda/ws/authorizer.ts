import type { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const MEMBERS_TABLE = process.env.MEMBERS_TABLE!;

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.USER_POOL_CLIENT_ID!,
});

function deny(methodArn: string): APIGatewayAuthorizerResult {
  return {
    principalId: 'unauthorized',
    policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: 'Deny', Resource: methodArn }] },
  };
}

function allow(methodArn: string, animatorId: string, projectId: string): APIGatewayAuthorizerResult {
  return {
    principalId: animatorId,
    policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: methodArn }] },
    context: { animatorId, projectId },
  };
}

export const handler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const token = event.queryStringParameters?.token;
  const projectId = event.queryStringParameters?.projectId;
  if (!token || !projectId) return deny(event.methodArn);

  try {
    const payload = await verifier.verify(token);
    const animatorId = payload.sub;

    const membership = await ddb.send(new GetCommand({ TableName: MEMBERS_TABLE, Key: { projectId, animatorId } }));
    if (!membership.Item) return deny(event.methodArn);

    return allow(event.methodArn, animatorId, projectId);
  } catch (err) {
    console.error('ws authorizer rejected', err);
    return deny(event.methodArn);
  }
};
