import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';

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
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      environment: {
        PROJECTS_TABLE: props.projectsTable.tableName,
        MEMBERS_TABLE: props.membersTable.tableName,
        DOCUMENTS_BUCKET: props.documentsBucket.bucketName,
        USER_POOL_ID: props.userPool.userPoolId,
      },
    });
    props.projectsTable.grantReadWriteData(httpHandler);
    props.membersTable.grantReadWriteData(httpHandler);
    props.documentsBucket.grantReadWrite(httpHandler);
    // Needed only to resolve an invite email to a Cognito user id (sub) when sharing
    // a project — no user pool write access, just the one read-only lookup action.
    httpHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:ListUsers'],
        resources: [props.userPool.userPoolArn],
      }),
    );

    const httpAuthorizer = new HttpUserPoolAuthorizer('HttpAuthorizer', props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'animationboard-http',
      corsPreflight: {
        // Known frontend origins only: the local Vite dev server and the deployed
        // Amplify branch URL. Add any future custom domain here too.
        allowOrigins: ['http://localhost:5173', 'https://main.d73qalc1csxug.amplifyapp.com'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.PATCH, apigwv2.CorsHttpMethod.DELETE, apigwv2.CorsHttpMethod.PUT],
        allowHeaders: ['content-type', 'authorization'],
      },
    });
    httpApi.addRoutes({
      path: '/{proxy+}',
      // Deliberately excludes OPTIONS: ANY would include it and route CORS preflight
      // requests through the JWT authorizer too, which rejects them (browsers never
      // attach an Authorization header to a preflight request) and breaks CORS
      // entirely. Leaving OPTIONS unrouted lets API Gateway's own corsPreflight
      // handling (configured above) answer it directly, with no authorizer involved.
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST, apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE, apigwv2.HttpMethod.PUT],
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
