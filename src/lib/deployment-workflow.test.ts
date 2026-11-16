import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
};
type Workflow = {
  name: string;
  on: { workflow_run: { workflows: string[]; branches: string[]; types: string[] } };
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: {
    deploy: {
      if: string;
      environment: string;
      env: Record<string, string>;
      steps: Step[];
    };
  };
};
const workflow = parse(
  readFileSync(new URL('../../.github/workflows/deploy-supabase.yml', import.meta.url), 'utf8'),
) as Workflow;
const job = workflow.jobs.deploy;
const steps = job.steps;
const position = (name: string) => steps.findIndex((step) => step.name === name);

describe('ordered production release', () => {
  it('accepts only successful same-repository main push checks, never PR checks', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: ['Checks'],
      types: ['completed'],
      branches: ['main'],
    });
    const guards = [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_branch == 'main'",
      'github.event.workflow_run.head_repository.full_name == github.repository',
    ];
    expect(job.if.replace(/\s+/g, ' ').trim()).toBe(guards.join(' && '));
    expect(job.environment).toBe('production');
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('deploys the validated SHA and skips stale completed runs before any mutation', () => {
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'))!;
    expect(checkout.with?.ref).toBe('${{ github.event.workflow_run.head_sha }}');
    const revision = steps.find((step) => step.id === 'revision')!;
    expect(revision.run).toContain('git/ref/heads/main');
    expect(revision.run).toContain('$VALIDATED_SHA');
    expect(revision.run).toContain('current=false');
    expect(revision.run).toContain('current=true');
    for (const step of steps.slice(steps.indexOf(revision) + 1))
      expect(step.if).toBe("steps.revision.outputs.current == 'true'");
  });

  it('requires Vercel and database configuration before applying migrations', () => {
    const configuration = steps.find((step) => step.name === 'Check deployment configuration')!;
    for (const name of [
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_DB_PASSWORD',
      'SUPABASE_PROJECT_REF',
      'VERCEL_TOKEN',
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
    ]) {
      expect(job.env[name]).toMatch(/^\$\{\{ (secrets|vars)\./);
      expect(configuration.run).toContain(`$${name}`);
    }
    expect(position('Check deployment configuration')).toBeLessThan(
      position('Apply pending migrations'),
    );
    expect(configuration.run).toContain('exit 1');
  });

  it('runs migrations before a remote Vercel build without pulling secret placeholders', () => {
    const order = [
      'Verify Vercel project access',
      'Review pending migrations in log',
      'Apply pending migrations',
      'Deploy production application',
    ].map(position);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(steps[position('Verify Vercel project access')].run).toBe(
      'vercel link --yes --scope "$VERCEL_ORG_ID" --project "$VERCEL_PROJECT_ID" --token "$VERCEL_TOKEN"',
    );
    expect(steps[position('Apply pending migrations')].run).toContain('supabase db push --linked');
    expect(steps[position('Deploy production application')].run).toContain(
      'vercel deploy --prod --yes --token "$VERCEL_TOKEN"',
    );
    expect(JSON.stringify(steps)).not.toContain('vercel pull');
    expect(JSON.stringify(steps)).not.toContain('vercel build');
    expect(JSON.stringify(steps)).not.toContain('--prebuilt');
    expect(JSON.stringify(steps)).not.toContain('continue-on-error');
    expect(JSON.stringify(steps)).not.toContain('always()');
  });

  it('serializes the whole release without cancelling an in-flight migration', () => {
    expect(workflow.concurrency.group).toBe('supabase-production-migrations');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(steps.find((step) => step.name === 'Install Vercel CLI')!.run).toMatch(
      /vercel@\d+\.\d+\.\d+/,
    );
  });

  it('disables independent main Git deployments without disabling previews or CLI deploys', () => {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    expect(config.git.deploymentEnabled).toEqual({ main: false });
    expect(config.github?.enabled).not.toBe(false);
  });
});
