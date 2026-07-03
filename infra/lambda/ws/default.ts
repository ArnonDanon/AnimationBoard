import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('ws message', event.requestContext.connectionId, event.body);
  return { statusCode: 200, body: 'ack' };
};
