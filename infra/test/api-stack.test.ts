import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';

function synthApiStack() {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'eu-west-1' };
  const auth = new AuthStack(app, 'TestAuthStack', { env });
  const data = new DataStack(app, 'TestDataStack', { env });
  const api = new ApiStack(app, 'TestApiStack', {
    env,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    projectsTable: data.projectsTable,
    membersTable: data.membersTable,
    connectionsTable: data.connectionsTable,
    palettesTable: data.palettesTable,
    documentsBucket: data.documentsBucket,
  });
  return Template.fromStack(api);
}

describe('ApiStack', () => {
  const template = synthApiStack();

  test('WebSocket $connect route requires the custom Lambda authorizer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: '$connect',
      AuthorizationType: 'CUSTOM',
      AuthorizerId: Match.anyValue(),
    });
  });

  test('WebSocket $disconnect and $default routes carry no authorizer (post-connect messages reuse the already-authorized connection)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: '$disconnect',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: '$default',
      AuthorizationType: 'NONE',
    });
  });

  test('exactly one WebSocket REQUEST authorizer is defined', () => {
    template.resourcePropertiesCountIs('AWS::ApiGatewayV2::Authorizer', { AuthorizerType: 'REQUEST' }, 1);
  });

  test('the relay (default) handler is granted execute-api:ManageConnections, scoped to this WebSocket API', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'execute-api:ManageConnections',
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('the WebSocket authorizer Lambda is granted read access to the members table', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([Match.stringLikeRegexp('dynamodb:GetItem')]),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('HTTP API only routes the methods it actually handles (never ANY, so CORS preflight is not misrouted through the JWT authorizer)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: Match.stringLikeRegexp('^GET /'),
      AuthorizationType: 'JWT',
    });
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const routeKeys = Object.values(routes).map((r) => r.Properties.RouteKey);
    expect(routeKeys).not.toContain('OPTIONS /{proxy+}');
    expect(routeKeys).not.toContain('ANY /{proxy+}');
  });

  test('exactly four Lambda functions are defined for the WebSocket relay path (authorizer, connect, disconnect, default)', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    const wsFnNames = Object.keys(fns).filter((id) => id.startsWith('Ws'));
    expect(wsFnNames.sort()).toEqual(
      ['WsAuthorizerHandler3D9D66A5', 'WsConnectHandler224A8AE8', 'WsDefaultHandlerA9589733', 'WsDisconnectHandler2953FE4B'].sort(),
    );
  });

  test('the HTTP handler (specifically) can kick a revoked member\'s live WebSocket connection', () => {
    // Scoped to HttpStubHandler's own policy, not just "some" IAM::Policy in the
    // template — WsDefaultHandler also has ManageConnections, for the relay path.
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('^HttpStubHandlerServiceRole') })]) },
    });
    const statements = Object.values(policies).flatMap((p) => p.Properties.PolicyDocument.Statement);
    expect(statements).toEqual(
      expect.arrayContaining([expect.objectContaining({ Action: 'execute-api:ManageConnections', Effect: 'Allow' })]),
    );
    expect(statements).toEqual(
      expect.arrayContaining([expect.objectContaining({ Action: expect.arrayContaining(['dynamodb:Query']), Effect: 'Allow' })]),
    );
  });

  test('the HTTP handler has both WEBSOCKET_ENDPOINT and CONNECTIONS_TABLE env vars (IAM grants alone aren\'t enough — the handler reads these directly)', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          WEBSOCKET_ENDPOINT: Match.objectLike({ 'Fn::Join': Match.anyValue() }),
          CONNECTIONS_TABLE: Match.anyValue(),
        }),
      },
    });
  });

  test('the HTTP handler has a PALETTES_TABLE env var and read/write access to it', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ PALETTES_TABLE: Match.anyValue() }),
      },
    });
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: { Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('^HttpStubHandlerServiceRole') })]) },
    });
    const statements = Object.values(policies).flatMap((p) => p.Properties.PolicyDocument.Statement);
    expect(statements).toEqual(
      expect.arrayContaining([expect.objectContaining({ Action: expect.arrayContaining(['dynamodb:PutItem']), Effect: 'Allow' })]),
    );
  });
});
