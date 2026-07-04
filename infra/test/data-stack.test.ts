import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';

function synthDataStack() {
  const app = new cdk.App();
  const stack = new DataStack(app, 'TestDataStack', { env: { account: '123456789012', region: 'eu-west-1' } });
  return Template.fromStack(stack);
}

describe('DataStack', () => {
  const template = synthDataStack();

  test('ConnectionsTable has both the byProject and byAnimator GSIs', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'connectionId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'byProject', KeySchema: [{ AttributeName: 'projectId', KeyType: 'HASH' }] }),
        Match.objectLike({
          IndexName: 'byAnimator',
          KeySchema: [
            { AttributeName: 'animatorId', KeyType: 'HASH' },
            { AttributeName: 'projectId', KeyType: 'RANGE' },
          ],
        }),
      ]),
    });
  });

  test('ProjectMembersTable has the byAnimator GSI ("list my projects")', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'projectId', KeyType: 'HASH' },
        { AttributeName: 'animatorId', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'byAnimator',
          KeySchema: [
            { AttributeName: 'animatorId', KeyType: 'HASH' },
            { AttributeName: 'projectId', KeyType: 'RANGE' },
          ],
        }),
      ]),
    });
  });
});
