import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

interface Connection {
  connectionId: string;
  projectId: string;
  animatorId: string;
}

// Pure relay per ADR-006: this Lambda forwards bytes between connections in the same
// project, it never inspects or merges the Yjs update itself.
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { connectionId, domainName, stage } = event.requestContext;

  const sender = await ddb.send(new GetCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
  const senderConn = sender.Item as Connection | undefined;
  if (!senderConn) return { statusCode: 200, body: 'ignored (unknown connection)' };

  const siblings = await ddb.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'byProject',
      KeyConditionExpression: 'projectId = :p',
      ExpressionAttributeValues: { ':p': senderConn.projectId },
    }),
  );
  const targets = ((siblings.Items ?? []) as Connection[]).filter((c) => c.connectionId !== connectionId);
  if (targets.length === 0) return { statusCode: 200, body: 'ack' };

  const apiGw = new ApiGatewayManagementApiClient({ endpoint: `https://${domainName}/${stage}` });
  const data = Buffer.from(event.body ?? '', 'utf-8');

  await Promise.all(
    targets.map(async (target) => {
      try {
        await apiGw.send(new PostToConnectionCommand({ ConnectionId: target.connectionId, Data: data }));
      } catch (err) {
        if (err instanceof GoneException) {
          await ddb.send(new DeleteCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId: target.connectionId } }));
        } else {
          throw err;
        }
      }
    }),
  );

  return { statusCode: 200, body: 'ack' };
};
