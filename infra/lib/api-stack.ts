import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  projectsTable: dynamodb.Table;
  membersTable: dynamodb.Table;
  connectionsTable: dynamodb.Table;
  documentsBucket: s3.Bucket;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const httpHandler = new lambdaNode.NodejsFunction(this, 'HttpStubHandler', {
      entry: path.join(__dirname, '../lambda/http/handler.ts'),
      handler: 'handler',
    });
    props.projectsTable.grantReadWriteData(httpHandler);
    props.membersTable.grantReadWriteData(httpHandler);
    props.documentsBucket.grantReadWrite(httpHandler);

    const httpAuthorizer = new HttpUserPoolAuthorizer('HttpAuthorizer', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', { apiName: 'animationboard-http' });
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('HttpStubIntegration', httpHandler),
      authorizer: httpAuthorizer,
    });

    const wsConnectHandler = new lambdaNode.NodejsFunction(this, 'WsConnectHandler', {
      entry: path.join(__dirname, '../lambda/ws/connect.ts'),
      handler: 'handler',
    });
    const wsDisconnectHandler = new lambdaNode.NodejsFunction(this, 'WsDisconnectHandler', {
      entry: path.join(__dirname, '../lambda/ws/disconnect.ts'),
      handler: 'handler',
    });
    const wsDefaultHandler = new lambdaNode.NodejsFunction(this, 'WsDefaultHandler', {
      entry: path.join(__dirname, '../lambda/ws/default.ts'),
      handler: 'handler',
    });
    for (const fn of [wsConnectHandler, wsDisconnectHandler, wsDefaultHandler]) {
      props.connectionsTable.grantReadWriteData(fn);
    }

    const webSocketApi = new apigwv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: 'animationboard-realtime',
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('WsConnectIntegration', wsConnectHandler) },
      disconnectRouteOptions: { integration: new WebSocketLambdaIntegration('WsDisconnectIntegration', wsDisconnectHandler) },
      defaultRouteOptions: { integration: new WebSocketLambdaIntegration('WsDefaultIntegration', wsDefaultHandler) },
    });

    new apigwv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'poc',
      autoDeploy: true,
    });

    new cdk.CfnOutput(this, 'HttpApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'WebSocketApiUrl', { value: webSocketApi.apiEndpoint });
  }
}
