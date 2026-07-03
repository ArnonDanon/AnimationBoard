import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('ws disconnect', event.requestContext.connectionId);
  return { statusCode: 200, body: 'disconnected' };
};
