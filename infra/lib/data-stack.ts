import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class DataStack extends cdk.Stack {
  public readonly projectsTable: dynamodb.Table;
  public readonly membersTable: dynamodb.Table;
  public readonly connectionsTable: dynamodb.Table;
  public readonly documentsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // POC: PAY_PER_REQUEST + DESTROY everywhere in this stack — no provisioned
    // capacity to size, clean teardown over retention (docs/adr/004).

    this.projectsTable = new dynamodb.Table(this, 'ProjectsTable', {
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.membersTable = new dynamodb.Table(this, 'ProjectMembersTable', {
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'animatorId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.membersTable.addGlobalSecondaryIndex({
      indexName: 'byAnimator',
      partitionKey: { name: 'animatorId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
    });

    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    // Relay fan-out: given a sender's connectionId, find every other connection open
    // on the same project (infra/lambda/ws/default.ts).
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'byProject',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
    });
    // Not consumed by any handler yet, but cheap to declare now (table is empty) and
    // expensive to backfill later: finding/terminating one user's active connections
    // without a full scan, needed by a future "revoke a collaborator's access" action
    // (there's no revoke endpoint yet, only share/delete) and by presence/Awareness
    // (FR-COLLAB-3), both explicitly deferred past this epic — see docs/03-roadmap.md
    // Epic 10. Mirrors ProjectMembersTable's byAnimator index shape.
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'byAnimator',
      partitionKey: { name: 'animatorId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
    });

    this.documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}
