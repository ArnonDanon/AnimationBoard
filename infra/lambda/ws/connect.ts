import type { APIGatewayProxyWebsocketHandlerV2, APIGatewayProxyWebsocketEventV2WithRequestContext } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

// A dropped connection that never triggers $disconnect (network drop, Lambda cold
// shutdown) should still eventually age out of the table via DynamoDB TTL.
const CONNECTION_TTL_SECONDS = 24 * 60 * 60;

interface ConnectRequestContext {
  connectionId: string;
  authorizer: { animatorId: string; projectId: string };
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { connectionId, authorizer } = (
    event as unknown as APIGatewayProxyWebsocketEventV2WithRequestContext<ConnectRequestContext>
  ).requestContext;

  await ddb.send(
    new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        connectionId,
        projectId: authorizer.projectId,
        animatorId: authorizer.animatorId,
        ttl: Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS,
      },
    }),
  );

  return { statusCode: 200, body: 'connected' };
};
