#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

const auth = new AuthStack(app, 'AnimationBoardAuthStack', { env });
const data = new DataStack(app, 'AnimationBoardDataStack', { env });
new ApiStack(app, 'AnimationBoardApiStack', {
  env,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  projectsTable: data.projectsTable,
  membersTable: data.membersTable,
  connectionsTable: data.connectionsTable,
  documentsBucket: data.documentsBucket,
});
