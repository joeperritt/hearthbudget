import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../maintenance/log-retention.sql', import.meta.url), 'utf8');

describe('scheduled log retention', () => {
  it('removes scheduled-job history older than one day', () => {
    expect(sql).toContain("DELETE FROM cron.job_run_details WHERE end_time < now() - interval '1 day'");
  });
  it('removes HTTP responses older than one day', () => {
    expect(sql).toContain("DELETE FROM net._http_response WHERE created < now() - interval '1 day'");
  });
  it('truncates job history only when post-cleanup size exceeds 100 MB', () => {
    expect(sql).toMatch(/IF pg_total_relation_size\('cron.job_run_details'\) > 100000000 THEN\s+TRUNCATE TABLE cron.job_run_details/);
  });
});